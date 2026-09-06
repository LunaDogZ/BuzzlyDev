"""The protected-rows guard still fails on real drift after the KPI-5 change.

`protected_counts` used to subtract one fixture — this suite's ingestion
workspace. KPI-5 added a second, a load-test workspace holding ~2,400
`ad_insights` rows, and without a change the guard would have read those as the
live corpus growing and aborted every ingestion run from then on.

Widening a guard's exemption is exactly the kind of edit that can quietly turn
it off, so these tests exist to show it did not. They are offline: a fake `db`
answers counts from a dict, so the whole file runs in milliseconds and touches
no cloud project. That also lets a case be constructed that the live database
cannot be asked to produce on demand — someone deleting research rows.

Run:  python3 -m pytest tests/test_protected_scope.py -v
"""
from __future__ import annotations

import pytest

from kpi_harness import (
    KPI5_FIXTURE_ACCOUNT_KEYS,
    PROTECTED_BASELINE,
    TEST_TEAM_ID,
    HarnessAbort,
    assert_protected_unchanged,
    protected_counts,
)

INGESTION_ACCOUNTS = ["ing-acc-1", "ing-acc-2"]
KPI5_ACCOUNTS = ["k6-acc-a", "k6-acc-b"]


class FakeDb:
    """Answers only what `protected_counts` asks, from explicit row sets.

    Counting here is deliberately literal — the fake holds `ad_insights` as a
    list of account ids and counts by membership — so a scoping mistake in the
    code under test shows up as a wrong number rather than being absorbed by a
    clever stub.
    """

    def __init__(self, *, insight_accounts: list[str], import_jobs: dict[str, int],
                 dlq: dict[str, int], kpi5_seeded: bool):
        self.insight_accounts = insight_accounts
        self.import_jobs = import_jobs          # {"live": n, "test": n}
        self.dlq = dlq
        self.kpi5_seeded = kpi5_seeded

    def select(self, table: str, query: str) -> list[dict]:
        assert table == "ad_accounts", f"unexpected select on {table}"
        if f"team_id=eq.{TEST_TEAM_ID}" in query:
            return [{"id": i} for i in INGESTION_ACCOUNTS]
        if "platform_account_id=in." in query:
            # The literals the seeder writes; nothing else may match them.
            assert all(k in query for k in KPI5_FIXTURE_ACCOUNT_KEYS)
            return [{"id": i} for i in KPI5_ACCOUNTS] if self.kpi5_seeded else []
        raise AssertionError(f"unexpected ad_accounts query: {query}")

    def count(self, table: str, query: str = "") -> int:
        if table == "ad_insights":
            if query.startswith("ad_account_id=in."):
                inside = query.split("in.(", 1)[1].split(")", 1)[0].split(",")
                return sum(1 for a in self.insight_accounts if a in inside)
            return len(self.insight_accounts)
        if table == "import_jobs":
            return self.import_jobs["test"] if "team_id=eq." in query else sum(self.import_jobs.values())
        if table == "ingestion_dlq":
            return self.dlq["test"] if "team_id=eq." in query else sum(self.dlq.values())
        raise AssertionError(f"unexpected count on {table}")


def db(*, live_insights: int, ingestion_rows: int = 40, kpi5_rows: int = 0,
       kpi5_seeded: bool | None = None) -> FakeDb:
    """A database holding a given number of live, ingestion-fixture and KPI-5 rows."""
    accounts = (["live-acc"] * live_insights
                + [INGESTION_ACCOUNTS[0]] * ingestion_rows
                + [KPI5_ACCOUNTS[0]] * kpi5_rows)
    return FakeDb(
        insight_accounts=accounts,
        import_jobs={"live": PROTECTED_BASELINE["import_jobs"], "test": 5},
        dlq={"live": PROTECTED_BASELINE["ingestion_dlq"], "test": 2},
        kpi5_seeded=bool(kpi5_rows) if kpi5_seeded is None else kpi5_seeded,
    )


BASE = PROTECTED_BASELINE["ad_insights"]


def test_baseline_holds_before_the_kpi5_fixture_is_seeded():
    """The state every run has seen so far must still pass unchanged."""
    counts = protected_counts(db(live_insights=BASE))
    assert counts["ad_insights"] == BASE
    assert_protected_unchanged(db(live_insights=BASE), where="unit")


def test_kpi5_fixture_rows_do_not_count_as_live():
    """The point of the change: 2,400 seeded rows leave the live count alone."""
    counts = protected_counts(db(live_insights=BASE, kpi5_rows=2400))
    assert counts["ad_insights"] == BASE
    assert_protected_unchanged(db(live_insights=BASE, kpi5_rows=2400), where="unit")


def test_the_old_scope_would_have_aborted_on_those_same_rows():
    """Pins why the change was needed — and that it was not cosmetic.

    Reproduces the previous scope by hiding the fixture from the lookup: the
    accounts exist and hold rows, but `select` reports none, which is precisely
    what the code did before it knew to ask. The guard fires, and the number it
    reports is the one that would have blocked every future run.
    """
    fake = db(live_insights=BASE, kpi5_rows=2400)
    fake.kpi5_seeded = False                    # the pre-change blindness
    with pytest.raises(HarnessAbort) as exc:
        assert_protected_unchanged(fake, where="unit")
    assert f"expected {BASE}, found {BASE + 2400}" in str(exc.value)


@pytest.mark.parametrize("delta,label", [(-1, "one row deleted"), (+7, "seven rows appeared")])
def test_real_drift_still_aborts(delta: int, label: str):
    """The guard has not been turned off — with the fixture seeded and all.

    This is the case the whole file exists for. If widening the exemption had
    made the guard permissive, live rows could change underneath it and nothing
    would say so.
    """
    with pytest.raises(HarnessAbort) as exc:
        assert_protected_unchanged(db(live_insights=BASE + delta, kpi5_rows=2400), where=label)
    assert "scoping failure" in str(exc.value)
    assert f"expected {BASE}, found {BASE + delta}" in str(exc.value)


def test_drift_in_the_other_two_tables_still_aborts():
    """`ad_insights` is the table that moved; the other two must be untouched."""
    fake = db(live_insights=BASE, kpi5_rows=2400)
    fake.import_jobs["live"] += 3
    with pytest.raises(HarnessAbort) as exc:
        assert_protected_unchanged(fake, where="unit")
    assert "import_jobs" in str(exc.value)
