"""Where a validated file lands — the same tables the connected path writes.

An imported ad export and a synced ad account have to end up in *one* place, or
the dashboard shows two different truths. So this module writes nothing new: it
fills `ad_accounts`, `campaigns`, `ad_groups`, `ads`, `campaign_ads` and
`ad_insights`, exactly the tables `mock-api/server.ts` populates on connect, and
the charts that already render for synced data render for uploaded data with no
front-end change at all.

Idempotency without a schema change
-----------------------------------
Re-running a DAG must update rows, never duplicate them. `ad_insights` has a
unique key for that (`ad_account_id, ads_id, date`), but `campaigns`, `ads` and
`ad_groups` have nothing unique except their primary key — and adding unique
constraints to tables the app writes by hand would be a behaviour change well
outside this pipeline.

So the primary key *is* the idempotency key: every id here is
``uuid5(namespace, natural_key)``, a pure function of the file's own contents.
The second import of the same campaign computes the same uuid as the first, and
``on_conflict=id`` + ``resolution=merge-duplicates`` turns the insert into an
update. Two concurrent runs racing on the same campaign converge on one row
instead of creating two, which a select-then-insert could not promise.

One ad account per (workspace, platform) — not ours to choose
-------------------------------------------------------------
Uploaded data was originally going to land in its own ad account, so a sync
could never overwrite it. The database says otherwise: `ad_accounts` carries
UNIQUE ``(team_id, platform_id)``, so a workspace has exactly one Facebook
account and an import cannot open a second one. Imports therefore adopt the
workspace's existing account for their platform, and create it only when there
is none.

The consequence worth knowing: the mock connect path deletes every insight for
the account it syncs before writing (`mock-api/server.ts`, full-replace), so
re-running the local reseed after an import erases the imported rows for that
platform. That is a property of the dev mock, not of the schema — a real sync
upserts — but it does mean "import, then reseed" loses data locally.

Stdlib only, like its neighbours: the builders are pure functions and
:func:`ingest_ad_performance` touches Supabase only through the client it is
handed, so both are testable without Airflow and without a network.
"""

from __future__ import annotations

import datetime as dt
import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

# ── what each dataset can be stored as ────────────────────────────────────────

# The wedge datasets have nowhere to go yet: True Net Profit needs order, SKU,
# COGS and fee tables that do not exist (step 10 of the plan). Reading them is
# already proven — `income-report.csv` parses 3,458/3,458 — but *reading* is not
# *keeping*, and a job that reports 3,458 rows imported when nothing was stored
# would be a lie the merchant only discovers when their profit never appears.
TARGET_TABLE: dict[str, str | None] = {
    "ad_performance": "ad_insights",
    "shopee_income": None,
    "product_cogs": None,
}

DATASET_LABEL: dict[str, str] = {
    "ad_performance": "an ad performance export",
    "shopee_income": "a Shopee income report",
    "product_cogs": "a product cost (COGS) sheet",
}

# Import platform (what the merchant picked on /imports) -> `platforms.slug`.
# `cogs` and `generic` map to nothing on purpose: neither names a real ad
# platform, and inventing one would put a wrong logo next to their data.
PLATFORM_SLUG: dict[str, str | None] = {
    "meta": "facebook",
    "tiktok": "tiktok",
    "shopee_ads": "shopee",
    "shopee_income": "shopee",
    "cogs": None,
    "generic": None,
}

PLATFORM_LABEL: dict[str, str] = {
    "meta": "Meta",
    "tiktok": "TikTok",
    "shopee_ads": "Shopee Ads",
    "shopee_income": "Shopee",
    "cogs": "Product costs",
    "generic": "Uploaded files",
}

# Namespace for every derived id. Fixed forever — changing it would orphan every
# row a previous import wrote, so a re-import would duplicate instead of update.
IMPORT_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_DNS, "imports.buzzly.app")

# PostgREST compiles a batch into one statement, so a payload holding the same
# conflict target twice fails outright ("ON CONFLICT DO UPDATE cannot affect row
# a second time") and takes the whole file down with it. Every builder below
# therefore collapses rows by their key before returning them — `validate`
# already rejects duplicate rows within a file, and this is the second lock on
# the same door because the failure is file-wide.
_CENT = Decimal("0.01")
_RATE = Decimal("0.0001")


def target_table_for(dataset: str) -> str | None:
    return TARGET_TABLE.get(dataset)


def platform_slug_for(platform: str) -> str | None:
    return PLATFORM_SLUG.get(platform or "")


# ── identity ──────────────────────────────────────────────────────────────────


def _norm(value: Any) -> str:
    """Collapse a name to its comparison form.

    Case- and whitespace-insensitive, matching how `validate` decides two rows
    are the same row. If the two disagreed, a file whose ad appears as both
    "Serum Carousel" and "serum carousel" would have one row rejected as a
    duplicate and the other stored under a second ad — the same ad, twice.
    """
    return " ".join(str(value or "").split()).casefold()


def derived_id(kind: str, *parts: Any) -> str:
    """A stable uuid for a natural key. Same inputs, same id, forever."""
    return str(uuid.uuid5(IMPORT_NAMESPACE, "\x1f".join([kind, *(_norm(p) for p in parts)])))


def ad_account_row(*, team_id: str, platform: str, platform_id: str | None) -> dict:
    """The account row to create when the workspace has none for this platform."""
    label = PLATFORM_LABEL.get(platform, "Uploaded files")
    return {
        "id": derived_id("ad_account", team_id, platform),
        "team_id": team_id,
        "platform_id": platform_id,
        "account_name": f"{label} (file import)",
        # Says where the account came from, for anyone reading the table later.
        # Only ever set on an account this pipeline created — an account the
        # merchant connected keeps its own name and id.
        "platform_account_id": f"buzzly-import:{platform}",
        "is_active": True,
    }


def resolve_ad_account(client, *, team_id: str, platform: str, platform_id: str | None) -> str:
    """The id of the account this file's rows belong to.

    Adopt-or-create, never upsert. UNIQUE ``(team_id, platform_id)`` means an
    upsert on the natural key would have to overwrite the account the merchant
    connected — renaming it, or worse, rewriting the primary key that every
    campaign and insight already points at.

    The insert can still lose a race with a concurrent run for the same
    workspace and platform (runs are not serialised). The loser reads the
    winner's row rather than failing: both wanted the same account to exist,
    and it now does.
    """
    row = ad_account_row(team_id=team_id, platform=platform, platform_id=platform_id)
    if platform_id is None:
        # No platform, no unique key to collide with — the derived id is enough,
        # and an upsert on it keeps a retry from creating a second account.
        client.upsert_rows("ad_accounts", [row], on_conflict="id")
        return row["id"]

    query = f"team_id=eq.{team_id}&platform_id=eq.{platform_id}&select=id&limit=1"
    found = client.select_rows("ad_accounts", query)
    if found:
        return found[0]["id"]

    try:
        client.upsert_rows("ad_accounts", [row], on_conflict="id")
    except Exception:  # noqa: BLE001 — a duplicate here means someone else created it
        found = client.select_rows("ad_accounts", query)
        if not found:
            raise
        return found[0]["id"]
    return row["id"]


# ── numbers ───────────────────────────────────────────────────────────────────


def _add(left: Any, right: Any) -> Any:
    """Sum two optional numbers, keeping None to mean "the file said nothing"."""
    if left is None:
        return right
    if right is None:
        return left
    return left + right


def _quantize(value: Any, exponent: Decimal) -> Any:
    if value is None:
        return None
    return Decimal(value).quantize(exponent, rounding=ROUND_HALF_UP)


def _ratio(numerator: Any, denominator: Any, scale: int = 1) -> Decimal | None:
    if numerator is None or not denominator:
        return None
    return (Decimal(numerator) / Decimal(denominator)) * scale


def _first_fitting(candidates: tuple, exponent: Decimal, limit: Decimal) -> Any:
    """The first candidate the column can actually hold.

    Rates are the one place where dropping a value is better than failing: a
    nonsense CTR in one cell would otherwise overflow `numeric(8,4)`, and
    PostgREST fails the whole statement, so a single junk cell would cost the
    merchant every row in the file. Note the deliberate asymmetry — `spend` is
    never dropped this way. A missing rate is a blank column; a missing cost is
    an understated cost, which is the exact error this product exists to remove.
    """
    for candidate in candidates:
        value = _quantize(candidate, exponent)
        if value is not None and abs(value) <= limit:
            return value
    return None


# Column ceilings: ad_insights.ctr is numeric(8,4); cpc/cpm/roas are numeric(15,2).
_RATE_LIMIT = Decimal("9999.9999")
_MONEY_LIMIT = Decimal("9999999999999.99")


def _rates(bucket: dict) -> dict:
    """Fill in ctr/cpc/cpm/roas for one insight row.

    A single source row keeps the numbers the merchant's own export states —
    we are not in the business of correcting their platform's arithmetic. When
    several rows collapse into one (the same ad, the same day, split by
    placement) their rates cannot be summed, so only the value derived from the
    summed base metrics is used: a stored CTR that contradicts the clicks and
    impressions stored beside it is a defect in our data, and one of the merged
    rows' rates is not "the" rate for the merged row.
    """
    single = bucket["sources"] == 1
    impressions, clicks, spend = bucket["impressions"], bucket["clicks"], bucket["spend"]

    revenue = bucket["revenue"]

    def order(stated: Any, derived: Any) -> tuple:
        return (stated, derived) if single else (derived,)

    return {
        "ctr": _first_fitting(
            order(bucket["ctr"], _ratio(clicks, impressions, 100)), _RATE, _RATE_LIMIT),
        "cpc": _first_fitting(
            order(bucket["cpc"], _ratio(spend, clicks)), _CENT, _MONEY_LIMIT),
        "cpm": _first_fitting(
            order(bucket["cpm"], _ratio(spend, impressions, 1000)), _CENT, _MONEY_LIMIT),
        "roas": _first_fitting(
            order(bucket["roas"], _ratio(revenue, spend)), _CENT, _MONEY_LIMIT),
    }


# ── ad performance -> the ad tables ───────────────────────────────────────────

_AD_STATUSES = frozenset({"active", "paused", "completed", "draft", "archived"})

INSIGHT_COLUMNS = (
    "ad_account_id", "campaign_id", "ads_id", "date",
    "impressions", "reach", "clicks", "conversions", "spend", "ctr", "cpc", "cpm", "roas",
)


def _ad_status(value: Any) -> str:
    """Map an export's delivery status onto the app's ad statuses."""
    text = _norm(value)
    if text in _AD_STATUSES:
        return text
    if "paus" in text or "หยุด" in text:
        return "paused"
    return "active"


def build_ad_performance_payload(
    records: list[dict], *, team_id: str, platform: str, ad_account_id: str
) -> dict:
    """Turn validated ad rows into the exact rows each table needs.

    Every insight is attached to an ad, even when the file has no ad column.
    That is not tidiness: the unique key is ``(ad_account_id, ads_id, date)``
    with NULLS NOT DISTINCT, so a null `ads_id` makes *every campaign on the
    same day* collide into a single row — a Shopee ads report, which is
    campaign-level by nature, would arrive as one campaign's numbers. Each
    campaign (or ad set) therefore gets one stand-in ad named for what it
    actually is.
    """
    campaigns: dict[str, dict] = {}
    windows: dict[str, list[dt.date]] = {}
    ad_groups: dict[str, dict] = {}
    ads: dict[str, dict] = {}
    links: dict[tuple[str, str], dict] = {}
    buckets: dict[tuple[str, str], dict] = {}

    for record in records:
        values = record["values"]
        campaign_name = str(values.get("campaign_name") or "").strip()
        date = values.get("date")
        if not campaign_name or not isinstance(date, dt.date):
            # `validate` requires both for this dataset, so reaching here means a
            # stage regressed. Failing beats ingesting fewer rows than the job
            # is about to report — silently dropping rows is the one outcome
            # worse than a failed import.
            raise ValueError(
                f"Row {record.get('row_number')} reached the upsert without a "
                f"campaign name and date (campaign={campaign_name!r}, date={date!r})"
            )

        group_name = str(values.get("ad_group_name") or "").strip()
        ad_name = str(values.get("ad_name") or "").strip()

        campaign_id = derived_id("campaign", team_id, platform, campaign_name)
        campaigns.setdefault(campaign_id, {
            "id": campaign_id,
            "team_id": team_id,
            "ad_account_id": ad_account_id,
            "name": campaign_name,
            "status": "active",
            "objective": "CONVERSIONS",
        })
        windows.setdefault(campaign_id, []).append(date)

        group_id = None
        if group_name:
            group_id = derived_id("ad_group", team_id, platform, group_name)
            ad_groups.setdefault(group_id, {
                "id": group_id,
                "team_id": team_id,
                "name": group_name,
                "source_platform": platform,
                "external_group_id": f"import:{group_id}",
                "status": "active",
            })

        # Keyed on the source columns, never on the stand-in label: when the
        # merchant later uploads the same campaign *with* an ad column, those
        # rows must become new ads rather than merge into the stand-in.
        ad_id = derived_id("ad", team_id, platform, campaign_name, group_name, ad_name)
        if ad_name:
            ad_label = ad_name
        elif group_name:
            ad_label = f"{group_name} (ad set total)"
        else:
            ad_label = f"{campaign_name} (campaign total)"
        ads.setdefault(ad_id, {
            "id": ad_id,
            "team_id": team_id,
            "ad_group_id": group_id,
            "name": ad_label,
            "platform": platform,
            "platform_ad_id": f"import:{ad_id}",
            "status": _ad_status(values.get("status")),
            "external_status": "published",
        })
        links.setdefault((campaign_id, ad_id), {"campaign_id": campaign_id, "ad_id": ad_id})

        key = (ad_id, date.isoformat())
        bucket = buckets.get(key)
        if bucket is None:
            bucket = buckets[key] = {
                "sources": 0, "campaign_id": campaign_id, "ads_id": ad_id,
                "date": date.isoformat(),
                "impressions": None, "reach": None, "clicks": None, "conversions": None,
                "spend": None, "revenue": None, "ctr": None, "cpc": None, "cpm": None,
                "roas": None,
            }
        bucket["sources"] += 1
        for field in ("impressions", "reach", "clicks", "conversions", "spend"):
            bucket[field] = _add(bucket[field], values.get(field))
        # Revenue is recovered *per row*, before anything is summed: an export
        # that reports ROAS but no revenue still states one (spend x ROAS), and
        # each row's ROAS belongs to that row's spend. Recovering it later, from
        # the merged bucket, would multiply one row's ratio by everyone's spend.
        # ad_insights has no revenue column — this exists so several rows merge
        # into one honest ROAS instead of an average of ratios.
        revenue = values.get("revenue")
        if revenue is None and values.get("roas") is not None and values.get("spend") is not None:
            revenue = Decimal(values["roas"]) * Decimal(values["spend"])
        bucket["revenue"] = _add(bucket["revenue"], revenue)
        for field in ("ctr", "cpc", "cpm", "roas"):
            if bucket[field] is None:
                bucket[field] = values.get(field)

    # The window is kept out of the campaign row on purpose — see
    # `campaign_window_filters`. Putting it in the upsert would make the newest
    # import's date range replace, rather than extend, the campaign's.
    campaign_windows = [
        {
            "id": campaign_id,
            "start_date": f"{min(dates).isoformat()}T00:00:00Z",
            "end_date": f"{max(dates).isoformat()}T23:59:59Z",
        }
        for campaign_id, dates in windows.items()
    ]

    insights = []
    for bucket in buckets.values():
        row = {
            "ad_account_id": ad_account_id,
            "campaign_id": bucket["campaign_id"],
            "ads_id": bucket["ads_id"],
            "date": bucket["date"],
            "impressions": bucket["impressions"],
            "reach": bucket["reach"],
            "clicks": bucket["clicks"],
            "conversions": bucket["conversions"],
            "spend": _quantize(bucket["spend"], _CENT),
            **_rates(bucket),
        }
        insights.append({column: row[column] for column in INSIGHT_COLUMNS})

    return {
        "campaigns": list(campaigns.values()),
        "campaign_windows": campaign_windows,
        "ad_groups": list(ad_groups.values()),
        "ads": list(ads.values()),
        "campaign_ads": list(links.values()),
        "insights": insights,
    }


def campaign_window_filters(window: dict) -> list[tuple[str, dict]]:
    """The conditional updates that stretch one campaign's dates to fit.

    A campaign's window must cover every import it has received: upload June,
    then July, and it ran across both. The obvious implementation — read the
    campaign, widen in Python, write it back — is a read-modify-write, and two
    imports landing together lose one of the two windows. That is not
    hypothetical; it happened on the first live run of this code, and the
    campaign ended up claiming a range narrower than its own insights.

    So the widening is expressed as a filter instead. Each returned filter
    matches only when the stored value is missing or narrower than this file's,
    which makes the update a single conditional statement the database
    serialises for us. Concurrent imports then converge on the union of their
    windows whatever order they arrive in, and nothing can shrink a window.
    """
    return [
        (f"id=eq.{window['id']}&or=({field}.is.null,{field}.{comparison}.{window[field]})",
         {field: window[field]})
        for field, comparison in (("start_date", "gt"), ("end_date", "lt"))
    ]


def sync_history_row(
    *,
    import_job_id: str,
    team_id: str,
    platform_id: str,
    rows_synced: int,
    started_at: str,
    completed_at: str,
    status: str = "success",
    error_message: str | None = None,
) -> dict:
    """One `sync_history` entry per import, keyed to the job.

    Derived from the job id so a retried task updates its own row rather than
    logging the same import twice — the entry is a statement about the import,
    and an import happened once however many attempts it took.
    """
    return {
        "id": derived_id("sync", import_job_id),
        "team_id": team_id,
        "platform_id": platform_id,
        # The merchant pressed Upload; nothing scheduled this and no platform
        # called us. `manual` is the only honest option of the three.
        "sync_type": "manual",
        "status": status,
        "rows_synced": rows_synced,
        "error_message": error_message,
        "started_at": started_at,
        "completed_at": completed_at,
    }


# ── the write ─────────────────────────────────────────────────────────────────


def ingest_ad_performance(client, payload: dict) -> dict:
    """Write one file's ad rows. Returns what landed in each table.

    Order is dictated by foreign keys — an ad cannot reference an ad group that
    does not exist yet, and an insight cannot reference either. `client` is
    only ever asked for `select_rows` and `upsert_rows`, which is what keeps
    this function testable against a stub.
    """
    written = {"ad_groups": 0, "campaigns": 0, "ads": 0, "campaign_ads": 0, "insights": 0}
    written["ad_groups"] = client.upsert_rows("ad_groups", payload["ad_groups"], on_conflict="id")

    written["campaigns"] = client.upsert_rows("campaigns", payload["campaigns"], on_conflict="id")
    for window in payload["campaign_windows"]:
        for query, patch in campaign_window_filters(window):
            client.patch_rows("campaigns", query, patch)

    written["ads"] = client.upsert_rows("ads", payload["ads"], on_conflict="id")
    written["campaign_ads"] = client.upsert_rows(
        "campaign_ads", payload["campaign_ads"], on_conflict="campaign_id,ad_id"
    )
    written["insights"] = client.upsert_rows(
        "ad_insights", payload["insights"], on_conflict="ad_account_id,ads_id,date"
    )
    return written
