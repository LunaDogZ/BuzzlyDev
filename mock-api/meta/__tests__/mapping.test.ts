import { describe, expect, it } from 'vitest';

import {
  ADD_TO_CART_ACTIONS,
  addDecimals,
  assertSupportedCurrency,
  buildMetaPayload,
  derivedId,
  LEAD_ACTIONS,
  mapAdStatus,
  MetaSyncRefused,
  PURCHASE_ACTIONS,
  sumActions,
  sumActionValues,
  toCount,
  toDecimal,
  uuid5,
  type MetaInsightRow,
} from '../mapping';
import { rollingWindow, shiftDays, todayIn } from '../client';

// Every expectation below is hand-declared. None of it was produced by running
// the code under test and pasting the answer back — a spec computed from the
// thing it measures only proves self-agreement (CLAUDE.md §11).

const CONTEXT = {
  teamId: '11111111-1111-1111-1111-111111111111',
  adAccountId: '22222222-2222-2222-2222-222222222222',
  platform: 'facebook',
};

/** Two campaigns delivering on the SAME DAY. This shape is the whole reason
 *  the grain is ad-level: at campaign level these two rows collide on
 *  `(ad_account_id, ads_id, date)` and one silently overwrites the other. */
const TWO_CAMPAIGNS_ONE_DAY: MetaInsightRow[] = [
  {
    date_start: '2026-08-10',
    date_stop: '2026-08-10',
    campaign_id: '120200000000001',
    campaign_name: 'แคมเปญ ก',
    adset_id: '120300000000001',
    adset_name: 'ชุดโฆษณา ก',
    ad_id: '120400000000001',
    ad_name: 'โฆษณา ก',
    impressions: '1200',
    clicks: '34',
    reach: '900',
    spend: '15.90',
    ctr: '2.83',
    cpc: '0.47',
    cpm: '13.25',
  },
  {
    date_start: '2026-08-10',
    date_stop: '2026-08-10',
    campaign_id: '120200000000002',
    campaign_name: 'แคมเปญ ข',
    adset_id: '120300000000002',
    adset_name: 'ชุดโฆษณา ข',
    ad_id: '120400000000002',
    ad_name: 'โฆษณา ข',
    impressions: '800',
    clicks: '12',
    reach: '600',
    spend: '9.10',
    ctr: '1.50',
    cpc: '0.76',
    cpm: '11.38',
  },
];

describe('uuid5', () => {
  it('matches the published RFC 4122 test vector', () => {
    // Independent oracle: uuid5(DNS, "python.org") is a documented value, so
    // this checks the implementation against something outside this repo.
    expect(uuid5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'python.org')).toBe(
      '886313e1-3b8a-5372-9b90-0c9aee199e5d',
    );
  });

  it('rejects a namespace that is not a uuid', () => {
    expect(() => uuid5('not-a-uuid', 'x')).toThrow(/namespace/);
  });
});

describe('derivedId', () => {
  it('is stable across calls', () => {
    expect(derivedId('ad', 'team', '999')).toBe(derivedId('ad', 'team', '999'));
  });

  it('does not let a part impersonate a boundary', () => {
    // ("a", "b|c") and ("a|b", "c") must be different ids. A naive join on a
    // printable character would collide them.
    expect(derivedId('ad', 'a', 'b|c')).not.toBe(derivedId('ad', 'a|b', 'c'));
  });

  it('separates kinds', () => {
    expect(derivedId('ad', 'x')).not.toBe(derivedId('campaign', 'x'));
  });
});

describe('addDecimals', () => {
  it('adds without binary float drift', () => {
    // 0.1 + 0.2 === 0.30000000000000004 as doubles. The whole point.
    expect(addDecimals(['0.1', '0.2'])).toBe('0.3');
  });

  it('aligns mixed scales on the widest', () => {
    expect(addDecimals(['15.90', '9.1', '0.005'])).toBe('25.005');
  });

  it('sums the real account s known daily spends exactly', () => {
    expect(addDecimals(['15.90', '9.10'])).toBe('25.00');
  });

  it('handles negatives and an empty list', () => {
    expect(addDecimals(['5.00', '-1.25'])).toBe('3.75');
    expect(addDecimals([])).toBe('0');
  });

  it('refuses a value that is not a decimal number', () => {
    expect(() => addDecimals(['1.0', 'abc'])).toThrow(/decimal/);
  });
});

describe('sumActions', () => {
  it('counts only the two purchase types', () => {
    const actions = [
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' },
      { action_type: 'onsite_conversion.purchase', value: '2' },
      { action_type: 'link_click', value: '99' },
    ];
    expect(sumActions(actions, PURCHASE_ACTIONS)).toBe(5);
  });

  it('never counts omni_purchase, which already contains the others', () => {
    const actions = [
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '3' },
      { action_type: 'omni_purchase', value: '3' },
    ];
    // 3, not 6. Adding the roll-up doubles every purchase.
    expect(sumActions(actions, PURCHASE_ACTIONS)).toBe(3);
  });

  it('returns null when Meta reported no actions at all', () => {
    // Absent is not zero: a stored 0 would claim we measured something.
    expect(sumActions(undefined, PURCHASE_ACTIONS)).toBeNull();
    expect(sumActions(null, PURCHASE_ACTIONS)).toBeNull();
  });

  it('returns 0 when actions exist but none are of the wanted type', () => {
    expect(sumActions([{ action_type: 'link_click', value: '4' }], PURCHASE_ACTIONS)).toBe(0);
  });

  it('reads add-to-cart and lead types off the same row', () => {
    const actions = [
      { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: '7' },
      { action_type: 'leadgen_grouped', value: '2' },
      { action_type: 'lead', value: '2' },
    ];
    expect(sumActions(actions, ADD_TO_CART_ACTIONS)).toBe(7);
    // `lead` is the aggregate and is excluded, so 2 rather than 4.
    expect(sumActions(actions, LEAD_ACTIONS)).toBe(2);
  });
});

describe('sumActionValues', () => {
  // The five action types the live account reported ฿3,605.00 under, all
  // exactly equal, measured 2026-08-14 by scripts/meta-revenue-probe.mjs.
  const THE_FIVE = [
    'onsite_conversion.purchase',
    'omni_purchase',
    'onsite_app_purchase',
    'onsite_web_purchase',
    'onsite_web_app_purchase',
  ].map((action_type) => ({ action_type, value: '3605.00' }));

  it('takes ฿3,605 once, not the ฿18,025 a naive sum would report', () => {
    // This is the whole reason revenue goes through an allow-list. Five labels
    // over one set of purchases: summing them overstates revenue 5×, and a 5×
    // ROAS is the kind of number a merchant spends real money on.
    expect(sumActionValues(THE_FIVE, PURCHASE_ACTIONS)).toBe('3605.00');
  });

  it('adds two allowed types exactly, where a float would not', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS. Money is the product.
    const values = [
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '0.10' },
      { action_type: 'onsite_conversion.purchase', value: '0.20' },
    ];
    expect(sumActionValues(values, PURCHASE_ACTIONS)).toBe('0.30');
  });

  it('aligns mixed scales on the widest', () => {
    const values = [
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '1.5' },
      { action_type: 'onsite_conversion.purchase', value: '0.25' },
    ];
    expect(sumActionValues(values, PURCHASE_ACTIONS)).toBe('1.75');
  });

  it('returns null when Meta attributed no value at all', () => {
    // NULL reaches the column, and the dashboard withholds a ROAS rather than
    // printing 0.0x for a row nobody measured.
    expect(sumActionValues(undefined, PURCHASE_ACTIONS)).toBeNull();
    expect(sumActionValues(null, PURCHASE_ACTIONS)).toBeNull();
  });

  it('returns a measured zero when values exist but none are purchases', () => {
    // Different claim from the one above: Meta answered, and the answer is that
    // no purchase value was attributed.
    const values = [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '12.00' }];
    expect(sumActionValues(values, PURCHASE_ACTIONS)).toBe('0');
  });

  it('skips a value it cannot parse instead of failing the sync', () => {
    const values = [
      { action_type: 'onsite_conversion.purchase', value: '฿1,205.00' },
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: '40.00' },
    ];
    expect(sumActionValues(values, PURCHASE_ACTIONS)).toBe('40.00');
  });

  it('accepts a number, because Meta is not consistent about quoting', () => {
    const values = [{ action_type: 'onsite_conversion.purchase', value: 12.5 }];
    expect(sumActionValues(values, PURCHASE_ACTIONS)).toBe('12.5');
  });
});

describe('field coercion', () => {
  it('keeps money as the exact string Meta sent', () => {
    // "15.90", not 15.9 — the trailing zero is part of what reconciles.
    expect(toDecimal('15.90')).toBe('15.90');
  });

  it('treats absent and unparseable as absent, never as zero', () => {
    expect(toDecimal('')).toBeNull();
    expect(toDecimal(null)).toBeNull();
    expect(toDecimal('฿15.90')).toBeNull();
    expect(toCount('')).toBeNull();
    expect(toCount(undefined)).toBeNull();
  });

  it('parses counts to integers', () => {
    expect(toCount('1200')).toBe(1200);
    expect(toCount('0')).toBe(0);
  });
});

describe('assertSupportedCurrency', () => {
  it('accepts THB', () => {
    expect(() => assertSupportedCurrency({ currency: 'THB' })).not.toThrow();
  });

  it('refuses USD with a stated reason', () => {
    // ad_insights has no currency column, so a USD row would be summed into ฿
    // totals and nothing downstream could tell.
    try {
      assertSupportedCurrency({ currency: 'USD' });
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(MetaSyncRefused);
      expect((e as MetaSyncRefused).reason).toBe('UNSUPPORTED_CURRENCY');
    }
  });

  it('refuses an account with no currency at all', () => {
    expect(() => assertSupportedCurrency({})).toThrow(MetaSyncRefused);
  });
});

describe('mapAdStatus', () => {
  it('maps the delivery states Meta actually returns', () => {
    expect(mapAdStatus('ACTIVE')).toBe('active');
    expect(mapAdStatus('PAUSED')).toBe('paused');
    expect(mapAdStatus('CAMPAIGN_PAUSED')).toBe('paused');
    expect(mapAdStatus('ARCHIVED')).toBe('archived');
  });

  it('falls back to paused, not active, on an unknown state', () => {
    // Claiming an ad is running when we do not recognise its state is the more
    // expensive of the two mistakes.
    expect(mapAdStatus('SOMETHING_NEW')).toBe('paused');
  });

  it('treats a missing status as active, because the insight proves delivery', () => {
    expect(mapAdStatus(undefined)).toBe('active');
  });
});

describe('buildMetaPayload', () => {
  it('keeps two same-day campaigns as two rows', () => {
    const payload = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    expect(payload.insights).toHaveLength(2);
    expect(new Set(payload.insights.map((r) => r.ads_id)).size).toBe(2);
    expect(payload.campaigns).toHaveLength(2);
    expect(payload.adGroups).toHaveLength(2);
    expect(payload.campaignAds).toHaveLength(2);
  });

  it('stamps every ad with the meta: prefix that keeps it out of the mock sync delete', () => {
    const payload = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    expect(payload.ads.map((a) => a.platform_ad_id).sort()).toEqual([
      'meta:120400000000001',
      'meta:120400000000002',
    ]);
  });

  it('labels every insight meta_live and leaves roas null', () => {
    const payload = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    for (const row of payload.insights) {
      expect(row.data_source).toBe('meta_live');
      // Meta's own `purchase_roas` came back on 5 of 32 live rows, and a stored
      // per-row ratio is the wrong shape anyway — averaging ratios weighs a ฿1
      // row like a ฿1,000 one. Revenue and spend are stored; the reader divides
      // the sums.
      expect(row.roas).toBeNull();
    }
  });

  it('passes ctr through unscaled, because Meta already sends a percentage', () => {
    const payload = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    const first = payload.insights.find((r) => r.date === '2026-08-10' && r.impressions === 1200);
    expect(first?.ctr).toBe('2.83');
    expect(first?.spend).toBe('15.90');
    expect(first?.clicks).toBe(34);
    expect(first?.reach).toBe(900);
  });

  it('reports exact totals', () => {
    const payload = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    expect(payload.totals).toEqual({
      spend: '25.00',
      // These rows carry no `action_values` at all, so the window measured no
      // revenue — reported as a zero total over zero rows, which is what makes
      // it distinguishable from ฿0 measured across two.
      revenue: '0',
      revenueRows: 0,
      impressions: 2000,
      clicks: 46,
      days: 1,
      activeDays: 1,
    });
  });

  it('stores revenue from action_values, keeping it a string', () => {
    const rows: MetaInsightRow[] = [
      {
        ...TWO_CAMPAIGNS_ONE_DAY[0],
        actions: [{ action_type: 'onsite_conversion.purchase', value: '2' }],
        action_values: [
          { action_type: 'onsite_conversion.purchase', value: '721.00' },
          // The roll-up Meta reports alongside it, carrying the same money.
          { action_type: 'omni_purchase', value: '721.00' },
        ],
      },
    ];
    const payload = buildMetaPayload(rows, CONTEXT);
    expect(payload.insights[0].revenue).toBe('721.00');
    expect(typeof payload.insights[0].revenue).toBe('string');
    expect(payload.insights[0].conversions).toBe(2);
  });

  it('leaves revenue null on a row Meta attributed no value to', () => {
    const rows: MetaInsightRow[] = [
      {
        ...TWO_CAMPAIGNS_ONE_DAY[0],
        actions: [{ action_type: 'link_click', value: '9' }],
      },
    ];
    const payload = buildMetaPayload(rows, CONTEXT);
    // NULL, not 0. The dashboard withholds ROAS on this; a 0 would let it
    // print 0.0x as though the campaign had been measured and earned nothing.
    expect(payload.insights[0].revenue).toBeNull();
  });

  it('totals revenue over the rows that have it, and counts them', () => {
    const rows: MetaInsightRow[] = [
      {
        ...TWO_CAMPAIGNS_ONE_DAY[0],
        date_start: '2026-08-10',
        action_values: [{ action_type: 'onsite_conversion.purchase', value: '721.00' }],
      },
      // No action_values: contributes nothing and is not counted.
      { ...TWO_CAMPAIGNS_ONE_DAY[0], date_start: '2026-08-11' },
      {
        ...TWO_CAMPAIGNS_ONE_DAY[0],
        date_start: '2026-08-12',
        action_values: [{ action_type: 'onsite_conversion.purchase', value: '1804.50' }],
      },
    ];
    const payload = buildMetaPayload(rows, CONTEXT);
    expect(payload.totals.revenue).toBe('2525.50');
    expect(payload.totals.revenueRows).toBe(2);
    expect(payload.insights).toHaveLength(3);
  });

  it('separates dates returned from dates that cost money', () => {
    // Measured against the live account, not assumed: its full history came
    // back as 31 rows over 26 dates, 7 of them entirely zero. Reporting the 26
    // to a merchant as "days you advertised" overstates it by a quarter.
    const rows: MetaInsightRow[] = [
      { ...TWO_CAMPAIGNS_ONE_DAY[0], date_start: '2025-07-15', spend: '15.90' },
      { ...TWO_CAMPAIGNS_ONE_DAY[0], date_start: '2025-07-16', spend: '0', impressions: '0', clicks: '0' },
      { ...TWO_CAMPAIGNS_ONE_DAY[0], date_start: '2025-07-17', spend: '0', impressions: '0', clicks: '0' },
    ];
    const payload = buildMetaPayload(rows, CONTEXT);
    expect(payload.totals.days).toBe(3);
    expect(payload.totals.activeDays).toBe(1);
    // The zero rows are still STORED — a zero Meta stated is a measurement,
    // unlike a zero invented for a date Meta omitted entirely.
    expect(payload.insights).toHaveLength(3);
  });

  it('skips a row with no ad_id instead of storing it under a NULL key', () => {
    // NULLS NOT DISTINCT means every such row would merge into one, so one
    // campaign's numbers would be stored as all of them.
    const payload = buildMetaPayload(
      [...TWO_CAMPAIGNS_ONE_DAY, { date_start: '2026-08-10', campaign_id: '1', spend: '5.00' }],
      CONTEXT,
    );
    expect(payload.insights).toHaveLength(2);
    expect(payload.skipped).toEqual([
      { reason: 'missing ad_id', date: '2026-08-10', adId: null },
    ]);
    // The skipped row's spend must not reach the total.
    expect(payload.totals.spend).toBe('25.00');
  });

  it('derives a campaign window from the days actually returned', () => {
    const rows: MetaInsightRow[] = [
      { ...TWO_CAMPAIGNS_ONE_DAY[0], date_start: '2026-08-01' },
      { ...TWO_CAMPAIGNS_ONE_DAY[0], date_start: '2026-08-09' },
      { ...TWO_CAMPAIGNS_ONE_DAY[0], date_start: '2026-08-05' },
    ];
    const payload = buildMetaPayload(rows, CONTEXT);
    expect(payload.campaignWindows).toHaveLength(1);
    expect(payload.campaignWindows[0].start_date).toBe('2026-08-01T00:00:00Z');
    expect(payload.campaignWindows[0].end_date).toBe('2026-08-09T23:59:59Z');
    // Three days for one ad = three insight rows, not one merged row.
    expect(payload.insights).toHaveLength(3);
  });

  it('never invents a day Meta did not return', () => {
    // Meta omits days with no delivery. The window below spans 9 days and
    // returns 3; the payload must contain 3.
    const rows: MetaInsightRow[] = ['2026-08-01', '2026-08-05', '2026-08-09'].map((d) => ({
      ...TWO_CAMPAIGNS_ONE_DAY[0],
      date_start: d,
    }));
    expect(buildMetaPayload(rows, CONTEXT).totals.days).toBe(3);
  });

  it('is deterministic — same input, byte-identical output', () => {
    const a = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    const b = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('gives a different workspace different ids for the same Meta ad', () => {
    const a = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    const b = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, {
      ...CONTEXT,
      teamId: '33333333-3333-3333-3333-333333333333',
    });
    expect(a.ads[0].id).not.toBe(b.ads[0].id);
  });

  it('still stores an ad that /ads no longer lists, marking it archived', () => {
    // An ad archived mid-window disappears from /ads but its spend was real.
    const payload = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT, {
      adStatus: new Map([['120400000000001', 'ARCHIVED']]),
    });
    const archived = payload.ads.find((a) => a.platform_ad_id === 'meta:120400000000001');
    const unlisted = payload.ads.find((a) => a.platform_ad_id === 'meta:120400000000002');
    expect(archived?.status).toBe('archived');
    // Not in the enrichment map at all — still written, still active.
    expect(unlisted?.status).toBe('active');
    expect(payload.insights).toHaveLength(2);
  });

  it('names a campaign by its id when Meta sends no name', () => {
    const payload = buildMetaPayload(
      [{ ...TWO_CAMPAIGNS_ONE_DAY[0], campaign_name: null, ad_name: null, adset_name: null }],
      CONTEXT,
    );
    expect(payload.campaigns[0].name).toBe('Meta campaign 120200000000001');
    expect(payload.ads[0].name).toBe('Meta ad 120400000000001');
    expect(payload.adGroups[0].name).toBe('Meta ad set 120300000000001');
  });

  it('carries conversions off the actions array', () => {
    const payload = buildMetaPayload(
      [
        {
          ...TWO_CAMPAIGNS_ONE_DAY[0],
          actions: [
            { action_type: 'offsite_conversion.fb_pixel_purchase', value: '2' },
            { action_type: 'omni_purchase', value: '2' },
            { action_type: 'offsite_conversion.fb_pixel_add_to_cart', value: '9' },
          ],
        },
      ],
      CONTEXT,
    );
    expect(payload.insights[0].conversions).toBe(2);
    expect(payload.insights[0].adds_to_cart).toBe(9);
    expect(payload.insights[0].leads).toBe(0);
  });

  it('leaves conversions null when the row has no actions field', () => {
    const payload = buildMetaPayload(TWO_CAMPAIGNS_ONE_DAY, CONTEXT);
    expect(payload.insights[0].conversions).toBeNull();
    expect(payload.insights[0].adds_to_cart).toBeNull();
    expect(payload.insights[0].leads).toBeNull();
  });
});

describe('window helpers', () => {
  it('reads the date in the account timezone, not UTC', () => {
    // 18:00 UTC is already the next day in Bangkok (UTC+7). Deriving the window
    // from UTC would drop the current Bangkok day for 7 hours a day.
    const instant = new Date('2026-08-12T18:00:00Z');
    expect(todayIn('Asia/Bangkok', instant)).toBe('2026-08-13');
    expect(todayIn('UTC', instant)).toBe('2026-08-12');
  });

  it('spans 30 inclusive days ending today', () => {
    const window = rollingWindow('Asia/Bangkok', new Date('2026-08-12T03:00:00Z'));
    expect(window).toEqual({ since: '2026-07-14', until: '2026-08-12' });
  });

  it('honours an explicit length, still inclusive of both ends', () => {
    const now = new Date('2026-09-11T03:00:00Z');
    // 90 days back from 11 Sep, counting 11 Sep itself, is 14 Jun.
    expect(rollingWindow('Asia/Bangkok', now, 90))
      .toEqual({ since: '2026-06-14', until: '2026-09-11' });
    // A one-day window is today twice, not an empty range.
    expect(rollingWindow('Asia/Bangkok', now, 1))
      .toEqual({ since: '2026-09-11', until: '2026-09-11' });
  });

  /**
   * The bug this pins, with the real numbers that exposed it.
   *
   * Workspace `32c0f027…` connected on 2026-09-11 and synced once. The window
   * was fixed at 30 days, so it asked Meta for 08-13 → 09-11. The ad account's
   * only campaign ran 08-09 → 08-14, which left exactly two days of overlap —
   * and the dashboard showed two days for an account with six days of spend.
   * Meta had all six the whole time; nothing ever asked for them.
   */
  it('reaches a campaign that ended before the default window opens', () => {
    const connectedOn = new Date('2026-09-11T03:00:00Z');
    const campaignStart = '2026-08-09';

    const byDefault = rollingWindow('Asia/Bangkok', connectedOn);
    expect(byDefault.since > campaignStart).toBe(true);

    const backfill = rollingWindow('Asia/Bangkok', connectedOn, 90);
    expect(backfill.since <= campaignStart).toBe(true);
  });

  it('shifts across a month boundary', () => {
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDays('2026-08-12', 1)).toBe('2026-08-13');
  });
});
