"""Tests for the last stage — validated rows becoming rows in the ad tables.

The rules under test here are the ones that fail *silently* in production if
they break: an id that stops being stable turns the second import of a file into
a duplicate rather than an update, a null `ads_id` merges unrelated campaigns
into one row through NULLS NOT DISTINCT, and a rate copied from one of several
merged rows contradicts the numbers stored beside it. None of those raise; they
just make the dashboard wrong. So they are pinned.

The end of the file runs the real merchant fixtures all the way through and
checks the totals that reach `ad_insights` against the totals in the file.
"""

from __future__ import annotations

import datetime as dt
import sys
from pathlib import Path
import unittest
from decimal import Decimal

# Self-contained on purpose: `unittest discover` imports these modules in
# alphabetical order, so a module that relied on a sibling to put `dags/` on
# the path would fail or pass depending on its own name.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dags"))

from buzzly_common.targets import (  # noqa: E402
    ad_account_row,
    resolve_ad_account,
    batch_id_for,
    build_ad_performance_payload,
    derived_id,
    ingest_ad_performance,
    platform_slug_for,
    stage_ad_performance,
    sync_history_row,
    target_table_for,
)

try:  # The fixture suite lives next door; reuse its loader rather than a copy.
    from test_ingest import FIXTURES, load
except ImportError:  # pragma: no cover - only when run as a package
    from .test_ingest import FIXTURES, load

TEAM = "b022da17-32cb-4694-bd72-0087bf427d79"


def record(row_number: int, **values) -> dict:
    """A validated record, in the shape `validate` emits."""
    return {"row_number": row_number, "values": values, "raw": {}, "issues": [], "truncated": False}


def payload_for(records: list[dict], platform: str = "meta") -> dict:
    account = ad_account_row(team_id=TEAM, platform=platform, platform_id=None)
    return build_ad_performance_payload(
        records, team_id=TEAM, platform=platform, ad_account_id=account["id"]
    )


class TestTargetRouting(unittest.TestCase):
    def test_ad_performance_has_a_home_and_the_wedge_datasets_do_not(self):
        self.assertEqual(target_table_for("ad_performance"), "ad_insights")
        self.assertIsNone(target_table_for("shopee_income"))
        self.assertIsNone(target_table_for("product_cogs"))

    def test_import_platforms_map_onto_real_platform_slugs(self):
        self.assertEqual(platform_slug_for("meta"), "facebook")
        self.assertEqual(platform_slug_for("shopee_ads"), "shopee")
        # Neither names an ad platform, so neither gets one.
        self.assertIsNone(platform_slug_for("cogs"))
        self.assertIsNone(platform_slug_for("generic"))


class TestIdentity(unittest.TestCase):
    def test_ids_are_stable_across_runs(self):
        first = derived_id("campaign", TEAM, "meta", "Summer Sale")
        second = derived_id("campaign", TEAM, "meta", "Summer Sale")
        self.assertEqual(first, second)

    def test_ids_are_scoped_to_the_workspace(self):
        other = "00000000-0000-0000-0000-000000000001"
        self.assertNotEqual(
            derived_id("campaign", TEAM, "meta", "Summer Sale"),
            derived_id("campaign", other, "meta", "Summer Sale"),
        )

    def test_case_and_spacing_do_not_create_a_second_row(self):
        # `validate` rejects the second of these two as a duplicate row; if the
        # id disagreed, the survivor would land under a different ad.
        self.assertEqual(
            derived_id("ad", TEAM, "meta", "Summer Sale", "", "Serum  Carousel"),
            derived_id("ad", TEAM, "meta", "summer sale", "", "serum carousel"),
        )

    def test_kinds_do_not_collide(self):
        self.assertNotEqual(derived_id("campaign", TEAM, "x"), derived_id("ad", TEAM, "x"))

    def test_a_created_account_says_where_it_came_from(self):
        account = ad_account_row(team_id=TEAM, platform="meta", platform_id="p1")
        self.assertEqual(account["platform_account_id"], "buzzly-import:meta")
        self.assertIn("file import", account["account_name"])


class TestBuildPayload(unittest.TestCase):
    def test_every_insight_has_an_ad_even_when_the_file_has_no_ad_column(self):
        # A Shopee ads report is campaign-level. With a null ads_id the unique
        # key (ad_account_id, ads_id, date) is NULLS NOT DISTINCT, so these two
        # campaigns would collapse into a single row.
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="Flash Sale", impressions=100),
            record(3, date=dt.date(2026, 7, 1), campaign_name="Always On", impressions=200),
        ], platform="shopee_ads")

        self.assertEqual(len(built["insights"]), 2)
        self.assertTrue(all(row["ads_id"] for row in built["insights"]))
        self.assertEqual(
            {ad["name"] for ad in built["ads"]},
            {"Flash Sale (campaign total)", "Always On (campaign total)"},
        )

    def test_a_stand_in_ad_does_not_absorb_a_later_named_ad(self):
        without = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="Flash Sale", impressions=100),
        ])
        with_name = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="Flash Sale",
                   ad_name="AD - Serum", impressions=100),
        ])
        self.assertNotEqual(without["ads"][0]["id"], with_name["ads"][0]["id"])

    def test_same_ad_name_in_two_campaigns_stays_two_ads(self):
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Video", clicks=1),
            record(3, date=dt.date(2026, 7, 1), campaign_name="B", ad_name="Video", clicks=1),
        ])
        self.assertEqual(len({ad["id"] for ad in built["ads"]}), 2)

    def test_campaign_window_covers_the_file(self):
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", impressions=1),
            record(3, date=dt.date(2026, 7, 9), campaign_name="A", impressions=1),
        ])
        window = built["campaign_windows"][0]
        self.assertTrue(window["start_date"].startswith("2026-07-01"))
        self.assertTrue(window["end_date"].startswith("2026-07-09"))

    def test_the_window_is_not_part_of_the_campaign_row(self):
        # Including it would make `merge-duplicates` replace the stored range
        # with this file's, so importing July after June would lose June.
        built = payload_for([record(2, date=dt.date(2026, 7, 1), campaign_name="A")])
        self.assertNotIn("start_date", built["campaigns"][0])

    def test_missing_date_or_campaign_is_a_failure_not_a_silent_drop(self):
        with self.assertRaises(ValueError):
            payload_for([record(2, date=dt.date(2026, 7, 1), campaign_name="")])
        with self.assertRaises(ValueError):
            payload_for([record(2, date=None, campaign_name="A")])

    def test_all_rows_of_a_batch_carry_the_same_columns(self):
        # PostgREST rejects a ragged batch outright (PGRST102), so this is a
        # file-wide failure, not a row-level one.
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", impressions=10, clicks=1),
            record(3, date=dt.date(2026, 7, 2), campaign_name="A", spend=Decimal("5.00")),
        ])
        keys = {tuple(sorted(row)) for row in built["insights"]}
        self.assertEqual(len(keys), 1)


class TestRates(unittest.TestCase):
    def test_a_single_row_keeps_the_numbers_the_export_states(self):
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   impressions=39043, clicks=750, spend=Decimal("2506.44"),
                   ctr=Decimal("1.92"), cpc=Decimal("3.34"), roas=Decimal("9.42")),
        ])
        row = built["insights"][0]
        self.assertEqual(row["ctr"], Decimal("1.9200"))
        self.assertEqual(row["cpc"], Decimal("3.34"))
        self.assertEqual(row["roas"], Decimal("9.42"))

    def test_a_missing_rate_is_derived(self):
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   impressions=1000, clicks=50, spend=Decimal("100.00")),
        ])
        row = built["insights"][0]
        self.assertEqual(row["ctr"], Decimal("5.0000"))
        self.assertEqual(row["cpc"], Decimal("2.00"))
        self.assertEqual(row["cpm"], Decimal("100.00"))

    def test_merged_rows_sum_and_re_derive_rather_than_pick_one(self):
        # The same ad on the same day, split by placement.
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   impressions=1000, clicks=10, spend=Decimal("50.00"), ctr=Decimal("1.00")),
            record(3, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   impressions=1000, clicks=90, spend=Decimal("50.00"), ctr=Decimal("9.00")),
        ])
        self.assertEqual(len(built["insights"]), 1)
        row = built["insights"][0]
        self.assertEqual(row["impressions"], 2000)
        self.assertEqual(row["clicks"], 100)
        self.assertEqual(row["spend"], Decimal("100.00"))
        # Neither 1.00 nor 9.00 — 100/2000.
        self.assertEqual(row["ctr"], Decimal("5.0000"))

    def test_merged_roas_is_weighted_by_spend_not_averaged(self):
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   spend=Decimal("100.00"), roas=Decimal("1.00")),
            record(3, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   spend=Decimal("900.00"), roas=Decimal("11.00")),
        ])
        # Revenue 100 + 9900 = 10000 on spend 1000. A plain average would say 6.
        self.assertEqual(built["insights"][0]["roas"], Decimal("10.00"))

    def test_a_nonsense_rate_is_dropped_instead_of_failing_the_file(self):
        # ad_insights.ctr is numeric(8,4); anything larger takes the whole
        # statement — and therefore every other row — down with it.
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   impressions=0, clicks=0, ctr=Decimal("100000")),
        ])
        self.assertIsNone(built["insights"][0]["ctr"])

    def test_stated_revenue_is_stored_not_only_used_for_roas(self):
        # The parser mapped it, typed it as Decimal and summed it, and then the
        # insight row dropped it. One such file put `data_source = 'import'`
        # into `computeRoas`'s "never reported revenue" set, which withholds
        # ROAS from the whole combined dashboard.
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   spend=Decimal("100.00"), revenue=Decimal("942.00")),
        ])
        self.assertEqual(built["insights"][0]["revenue"], Decimal("942.00"))

    def test_revenue_recovered_from_roas_is_stored_too(self):
        # An export that states ROAS but no revenue still states a revenue.
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   spend=Decimal("100.00"), roas=Decimal("9.42")),
        ])
        self.assertEqual(built["insights"][0]["revenue"], Decimal("942.00"))

    def test_a_file_that_never_mentions_revenue_stores_null_not_zero(self):
        # Silence, not a measurement of nothing. 0 would state that this ad
        # earned nothing, which no source here ever claimed.
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad",
                   impressions=1000, clicks=50, spend=Decimal("100.00")),
        ])
        self.assertIsNone(built["insights"][0]["revenue"])

    def test_an_absent_metric_stays_absent(self):
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_name="Ad", clicks=5),
        ])
        row = built["insights"][0]
        self.assertIsNone(row["impressions"])
        self.assertIsNone(row["spend"])
        self.assertEqual(row["clicks"], 5)


class TestCampaignWindows(unittest.TestCase):
    """The window may only ever grow, and only the database may decide it.

    The widening rule itself now lives in `promote_batch` — expressed as a
    conditional UPDATE so two imports landing together converge on the union of
    their windows rather than one overwriting the other. What is checked here is
    the half Python still owns: that the dates leave the builder as their own
    staged rows instead of being folded into the campaign upsert, which would
    make the newest import *replace* the range rather than extend it.
    """

    def test_the_window_is_staged_apart_from_the_campaign_row(self):
        built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A"),
            record(3, date=dt.date(2026, 7, 31), campaign_name="A"),
        ])
        self.assertEqual(built["campaign_windows"], [{
            "id": built["campaigns"][0]["id"],
            "start_date": "2026-07-01T00:00:00Z",
            "end_date": "2026-07-31T23:59:59Z",
        }])
        self.assertNotIn("start_date", built["campaigns"][0])
        self.assertNotIn("end_date", built["campaigns"][0])


class StubClient:
    """Records what would be written, so ordering and keys can be asserted."""

    UPSERT_BATCH_SIZE = 500

    def __init__(self, existing: dict | None = None, *, already_promoted: bool = False) -> None:
        self.calls: list[tuple[str, int, str]] = []
        self.staged: list[tuple[str, str, int]] = []
        self.rows: dict[str, list[dict]] = {}
        self.promotes: list[tuple[str, str, str]] = []
        self.existing = existing or {}
        self.already_promoted = already_promoted

    def select_rows(self, table: str, query: str) -> list[dict]:
        return self.existing.get(table, [])

    def upsert_rows(self, table: str, rows: list[dict], *, on_conflict: str) -> int:
        self.calls.append((table, len(rows), on_conflict))
        self.rows.setdefault(table, []).extend(rows)
        return len(rows)

    def stage_rows(self, batch_id: str, target_table: str, rows: list[dict]) -> int:
        self.staged.append((batch_id, target_table, len(rows)))
        self.rows.setdefault(target_table, []).extend(rows)
        return len(rows)

    def promote_batch(self, batch_id: str, import_job_id: str, team_id: str) -> dict:
        self.promotes.append((batch_id, import_job_id, team_id))
        insights = len(self.rows.get("ad_insights", []))
        return {
            "batch_id": batch_id,
            "already_promoted": self.already_promoted,
            "rows_promoted": insights,
            "counts": {target: len(rows) for target, rows in self.rows.items()},
        }


def ingest(client, built, **kwargs):
    """Call the write path with the arguments every caller has to supply."""
    return ingest_ad_performance(
        client, built,
        batch_id=kwargs.pop("batch_id", batch_id_for("job-1")),
        import_job_id=kwargs.pop("import_job_id", "job-1"),
        team_id=kwargs.pop("team_id", TEAM),
        **kwargs,
    )


class TestResolveAdAccount(unittest.TestCase):
    """UNIQUE (team_id, platform_id) means the workspace's account is the account."""

    def test_an_existing_account_is_adopted_never_rewritten(self):
        client = StubClient({"ad_accounts": [{"id": "connected-account"}]})
        resolved = resolve_ad_account(client, team_id=TEAM, platform="meta", platform_id="p1")
        self.assertEqual(resolved, "connected-account")
        # Nothing was written: renaming the account the merchant connected, or
        # rewriting the id every campaign points at, would both be worse than
        # having no import account at all.
        self.assertEqual(client.calls, [])

    def test_an_account_is_created_when_the_workspace_has_none(self):
        client = StubClient()
        resolved = resolve_ad_account(client, team_id=TEAM, platform="meta", platform_id="p1")
        self.assertEqual(client.calls, [("ad_accounts", 1, "id")])
        self.assertEqual(client.rows["ad_accounts"][0]["id"], resolved)

    def test_losing_the_race_reads_the_winner_rather_than_failing(self):
        class Racing(StubClient):
            def upsert_rows(self, table, rows, *, on_conflict):
                self.existing["ad_accounts"] = [{"id": "created-by-the-other-run"}]
                raise RuntimeError("duplicate key value violates unique constraint")

        resolved = resolve_ad_account(Racing(), team_id=TEAM, platform="meta", platform_id="p1")
        self.assertEqual(resolved, "created-by-the-other-run")


class TestIngest(unittest.TestCase):
    def setUp(self):
        self.built = payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_group_name="G",
                   ad_name="Ad", impressions=10, clicks=1, spend=Decimal("2.00")),
        ])

    def test_everything_is_staged_before_anything_is_committed(self):
        """Nothing may reach a real table until the single promote call."""
        client = StubClient()
        ingest(client, self.built)
        self.assertEqual(
            [target for _, target, _ in client.staged],
            ["ad_groups", "campaigns", "campaign_windows",
             "ads", "campaign_ads", "ad_insights"],
        )
        self.assertEqual(client.calls, [], "no table may be written directly")

    def test_the_commit_is_exactly_one_call(self):
        """One request is one transaction — more than one and it is not atomic."""
        client = StubClient()
        ingest(client, self.built)
        self.assertEqual(len(client.promotes), 1)
        self.assertEqual(client.promotes[0][1:], ("job-1", TEAM))

    def test_every_staged_row_carries_the_same_batch_id(self):
        client = StubClient()
        ingest(client, self.built)
        batches = {batch for batch, _, _ in client.staged} | {client.promotes[0][0]}
        self.assertEqual(batches, {batch_id_for("job-1")})

    def test_the_batch_id_is_derived_so_a_retry_reuses_it(self):
        """A retry that invented a new id would commit the file a second time."""
        self.assertEqual(batch_id_for("job-1"), batch_id_for("job-1"))
        self.assertNotEqual(batch_id_for("job-1"), batch_id_for("job-2"))

    def test_an_already_committed_batch_is_reported_not_rewritten(self):
        client = StubClient(already_promoted=True)
        result = ingest(client, self.built)
        self.assertTrue(result["already_promoted"])

    def test_sync_history_is_staged_with_the_data_not_written_beside_it(self):
        """It must not survive as evidence of a sync whose data rolled back."""
        client = StubClient()
        history = sync_history_row(
            import_job_id="job-1", team_id=TEAM, platform_id="p1", rows_synced=1,
            started_at="2026-08-05T00:00:00+00:00", completed_at="2026-08-05T00:00:05+00:00",
        )
        ingest(client, self.built, sync_history=history)
        self.assertIn("sync_history", [target for _, target, _ in client.staged])
        self.assertEqual(client.calls, [])

    def test_no_sync_history_is_staged_when_the_platform_has_none(self):
        client = StubClient()
        ingest(client, self.built, sync_history=None)
        self.assertNotIn("sync_history", [target for _, target, _ in client.staged])

    def test_reingesting_the_same_file_writes_the_same_ids(self):
        first, second = StubClient(), StubClient()
        ingest(first, self.built)
        ingest(second, payload_for([
            record(2, date=dt.date(2026, 7, 1), campaign_name="A", ad_group_name="G",
                   ad_name="Ad", impressions=10, clicks=1, spend=Decimal("2.00")),
        ]))
        self.assertEqual(first.rows["ad_insights"], second.rows["ad_insights"])

    def test_staging_reports_what_each_target_received(self):
        client = StubClient()
        staged = stage_ad_performance(client, "batch-1", self.built)
        self.assertEqual(staged["ad_insights"], 1)
        self.assertEqual(staged["campaigns"], 1)
        self.assertEqual(staged["campaign_windows"], 1)

    def test_sync_history_is_keyed_to_the_job_so_a_retry_does_not_log_twice(self):
        rows = [
            sync_history_row(import_job_id="job-1", team_id=TEAM, platform_id="p1",
                             rows_synced=n, started_at="2026-08-05T00:00:00+00:00",
                             completed_at="2026-08-05T00:00:10+00:00")
            for n in (10, 10)
        ]
        self.assertEqual(rows[0]["id"], rows[1]["id"])
        self.assertEqual(rows[0]["sync_type"], "manual")
        self.assertEqual(rows[0]["status"], "success")


@unittest.skipIf(FIXTURES is None, "fixtures/imports not found")
class TestAgainstFixtures(unittest.TestCase):
    """The real merchant files, from bytes to the rows ad_insights would hold."""

    def build(self, name: str, platform: str) -> dict:
        result = load(name, platform)
        self.assertEqual(result["dataset"], "ad_performance")
        return {"result": result, "payload": payload_for(result["ok"], platform)}

    def test_clean_meta_export_lands_one_row_per_accepted_row(self):
        built = self.build("meta/ads-export-clean.csv", "meta")
        self.assertEqual(len(built["payload"]["insights"]), built["result"]["counts"]["rows_ok"])
        self.assertEqual(len(built["payload"]["campaigns"]), 5)

    def test_totals_survive_the_journey_into_ad_insights(self):
        built = self.build("meta/ads-export-thai-dirty.csv", "meta")
        insights = built["payload"]["insights"]
        # Checked against the file's own รวมทั้งหมด row, which is dropped as
        # furniture and so is an independent witness to everything upstream.
        self.assertEqual(sum(row["impressions"] for row in insights), 1_081_585)
        self.assertEqual(sum(row["clicks"] for row in insights), 17_328)
        # That same row says ฿53,988.57 for spend, three satang above this. It
        # is the totals row that is wrong: the generator sums unrounded floats
        # while each printed row is rounded to two decimals. Summing the file's
        # own spend column by hand gives exactly this figure.
        self.assertEqual(sum(row["spend"] for row in insights), Decimal("53988.54"))

    def test_a_campaign_level_report_still_produces_distinct_rows(self):
        built = self.build("shopee/ads-report.csv", "shopee_ads")
        insights = built["payload"]["insights"]
        keys = {(row["ads_id"], row["date"]) for row in insights}
        self.assertEqual(len(keys), len(insights))
        self.assertEqual(len(insights), built["result"]["counts"]["rows_ok"])

    def test_tiktok_export_maps_onto_the_same_tables(self):
        built = self.build("tiktok/ads-export.csv", "tiktok")
        self.assertTrue(built["payload"]["ad_groups"])
        self.assertTrue(all(ad["platform"] == "tiktok" for ad in built["payload"]["ads"]))


if __name__ == "__main__":
    unittest.main()
