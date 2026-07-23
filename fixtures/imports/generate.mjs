#!/usr/bin/env node
/**
 * Generates the sample merchant-upload CSVs used by the Airflow ingestion pipeline.
 *
 * These simulate what a Thai D2C merchant already has on their own machine and
 * uploads into Buzzly when a platform API cannot be connected — the fallback path.
 *
 * Deterministic: a fixed PRNG seed means regenerating produces byte-identical
 * files, so research measurements stay reproducible across runs.
 *
 *   node fixtures/imports/generate.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));

// Anchor the window so output never drifts with the real clock.
const END_DATE = new Date("2026-07-23T00:00:00Z");
const DAYS = 30;
const SEED = 20260723;

// ---------------------------------------------------------------- primitives

/** mulberry32 — small deterministic PRNG. */
function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);
const randInt = (min, max) => Math.floor(rng() * (max - min + 1)) + min;
const jitter = (base, pct) => base * (1 + (rng() * 2 - 1) * pct);
const money = (n) => n.toFixed(2);

function dateRange(days, end) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d);
  }
  return out;
}

const iso = (d) => d.toISOString().slice(0, 10);
const pad = (n) => String(n).padStart(2, "0");

/** Thai Buddhist-era date: 24/06/2569 */
const thaiSlash = (d) =>
  `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543}`;

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
                     "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** Thai long form: 24 มิ.ย. 2569 */
const thaiLong = (d) =>
  `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`;

/** 1234.5 -> "1,234.50" */
const withCommas = (n) =>
  Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function write(relPath, content) {
  const full = join(ROOT, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, "utf8");
  const lines = content.split("\n").length - 1;
  console.log(`  ✓ ${relPath.padEnd(38)} ${String(lines).padStart(4)} lines`);
}

// ------------------------------------------------------------------ catalogue

// One shared product catalogue keeps ad spend, Shopee revenue and COGS tied to
// the SAME SKUs — required so True Net Profit can actually be computed later.
//
// The margin spread is deliberate. BZ-ELC-001 LOSES money once Shopee's fees and
// its ad spend are applied, while still showing a healthy-looking ROAS, and
// BZ-BND-001 is thin-but-positive. That is the whole point of the wedge: without
// this file having a loss-maker in it, the dashboard cannot demonstrate the
// persona's actual fear — scaling budget on a negative-margin SKU.
const PRODUCTS = [
  { sku: "BZ-SKN-001", name: "เซรั่มวิตามินซี 30ml",      price:  590, cogs: 180, organic: 0.25 },
  { sku: "BZ-SKN-002", name: "ครีมกันแดด SPF50 50g",      price:  450, cogs: 145, organic: 1.00 },
  { sku: "BZ-SUP-001", name: "คอลลาเจนเปปไทด์ 200g",       price:  890, cogs: 310, organic: 0.20 },
  { sku: "BZ-ACC-001", name: "กระเป๋าผ้าแคนวาส",           price:  320, cogs:  95, organic: 0.30 },
  { sku: "BZ-ACC-002", name: "ขวดน้ำเก็บความเย็น 500ml",   price:  380, cogs: 120, organic: 1.00 },
  { sku: "BZ-BND-001", name: "เซตของขวัญรวม 3 ชิ้น",       price: 1190, cogs: 890, organic: 0.10 },
  { sku: "BZ-ELC-001", name: "หูฟังบลูทูธไร้สาย",          price:  690, cogs: 560, organic: 0.10 },
];

const CAMPAIGNS = [
  { id: "23851234567890001", name: "Summer Sale - Skincare",     adset: "AS - Skincare Broad TH 25-44", ad: "AD - Serum Carousel",   sku: "BZ-SKN-001", scale: 1.00, tiktok: true  },
  { id: "23851234567890002", name: "Always On - Supplements",    adset: "AS - Collagen Lookalike 1%",   ad: "AD - Collagen Video",   sku: "BZ-SUP-001", scale: 0.55, tiktok: true  },
  { id: "23851234567890003", name: "Retargeting - All Products", adset: "AS - Website Visitors 30d",    ad: "AD - Dynamic Product",  sku: "BZ-ACC-001", scale: 0.30, tiktok: false },
  { id: "23851234567890004", name: "Push - Wireless Earbuds",    adset: "AS - Gadget Interest 18-34",   ad: "AD - Earbuds Reels",    sku: "BZ-ELC-001", scale: 0.70, tiktok: true  },
  { id: "23851234567890005", name: "Gift Set Bundle",            adset: "AS - Gifting Season TH",       ad: "AD - Bundle Static",    sku: "BZ-BND-001", scale: 0.40, tiktok: false },
];

const DATES = dateRange(DAYS, END_DATE);

/** Daily metrics for one campaign — internally consistent (CTR/CPC/CPM derived). */
function dailyMetrics(campaign, date, dayIndex) {
  // Gentle upward trend + weekend lift, so charts look like a real account.
  const trend = 1 + dayIndex / (DAYS * 2.5);
  const weekend = [0, 6].includes(date.getUTCDay()) ? 1.25 : 1.0;

  const impressions = Math.round(jitter(42000 * campaign.scale * trend * weekend, 0.18));
  const reach = Math.round(impressions * jitter(0.68, 0.06));
  const clicks = Math.round(impressions * jitter(0.016, 0.22));
  const spend = jitter(clicks * 3.1, 0.15);
  const conversions = Math.round(clicks * jitter(0.045, 0.3));

  const product = PRODUCTS.find((p) => p.sku === campaign.sku);
  const revenue = conversions * product.price;

  return {
    impressions,
    reach,
    clicks,
    spend,
    conversions,
    revenue,
    ctr: (clicks / impressions) * 100,
    cpc: spend / Math.max(clicks, 1),
    cpm: (spend / impressions) * 1000,
    roas: revenue / Math.max(spend, 1),
  };
}

// Precompute once so every export describes the SAME underlying business.
const SERIES = [];
DATES.forEach((date, dayIndex) => {
  CAMPAIGNS.forEach((campaign) => {
    SERIES.push({ date, campaign, m: dailyMetrics(campaign, date, dayIndex) });
  });
});

// ------------------------------------------------------- 1. Meta Ads (clean)

function metaClean() {
  const headers = [
    "Reporting starts", "Reporting ends", "Campaign name", "Ad set name", "Ad name",
    "Delivery status", "Impressions", "Reach", "Link clicks",
    "CTR (link click-through rate)", "CPC (cost per link click)",
    "CPM (cost per 1,000 impressions)", "Amount spent (THB)",
    "Results", "Cost per result", "Purchase ROAS (return on ad spend)",
  ];
  const rows = SERIES.map(({ date, campaign, m }) => [
    iso(date), iso(date), campaign.name, campaign.adset, campaign.ad, "active",
    m.impressions, m.reach, m.clicks,
    m.ctr.toFixed(2), money(m.cpc), money(m.cpm), money(m.spend),
    m.conversions, money(m.spend / Math.max(m.conversions, 1)), m.roas.toFixed(2),
  ]);
  write("meta/ads-export-clean.csv", toCsv(headers, rows));
}

// -------------------------------------------- 2. Meta Ads (Thai, messy real)

function metaThaiDirty() {
  const headers = [
    "วันที่เริ่มต้น", "วันที่สิ้นสุด", "ชื่อแคมเปญ", "ชื่อชุดโฆษณา", "ชื่อโฆษณา",
    "การแสดงผล", "การเข้าถึง", "คลิกลิงก์", "อัตราการคลิกผ่าน (%)",
    "ราคาต่อคลิก", "ราคาต่อการแสดงผล 1,000 ครั้ง", "จำนวนเงินที่ใช้จ่าย (฿)",
    "ผลลัพธ์", "ต้นทุนต่อผลลัพธ์", "ROAS",
  ];

  // Only the last 10 days — this file exists to exercise the parser, not volume.
  const subset = SERIES.slice(-30);
  const rows = subset.map(({ date, campaign, m }, i) => [
    // Two different Buddhist-era formats interleaved, as real exports do.
    i % 3 === 0 ? thaiLong(date) : thaiSlash(date),
    i % 3 === 0 ? thaiLong(date) : thaiSlash(date),
    campaign.name,
    // Trailing / non-breaking whitespace that must be normalised away.
    i % 4 === 0 ? `${campaign.adset} ` : campaign.adset,
    campaign.ad,
    withCommas(m.impressions).replace(".00", ""),
    withCommas(m.reach).replace(".00", ""),
    withCommas(m.clicks).replace(".00", ""),
    m.ctr.toFixed(2),
    `฿${withCommas(m.cpc)}`,
    `฿${withCommas(m.cpm)}`,
    `฿${withCommas(m.spend)}`,
    // Occasional blank result cell — a real gap, not a zero.
    i % 7 === 0 ? "" : m.conversions,
    i % 7 === 0 ? "" : `฿${withCommas(m.spend / Math.max(m.conversions, 1))}`,
    m.roas.toFixed(2),
  ]);

  const totals = subset.reduce(
    (acc, { m }) => ({
      impressions: acc.impressions + m.impressions,
      clicks: acc.clicks + m.clicks,
      spend: acc.spend + m.spend,
    }),
    { impressions: 0, clicks: 0, spend: 0 },
  );

  let csv = toCsv(headers, rows);
  // A blank separator line then a summary row — both must be dropped, not ingested.
  csv += "\r\n";
  csv += toCsv([], [[
    "รวมทั้งหมด", "", "", "", "",
    withCommas(totals.impressions).replace(".00", ""), "",
    withCommas(totals.clicks).replace(".00", ""), "", "", "",
    `฿${withCommas(totals.spend)}`, "", "", "",
  ]]);

  // UTF-8 BOM — Excel writes this and it corrupts the first header if unhandled.
  write("meta/ads-export-thai-dirty.csv", "﻿" + csv);
}

// ---------------------------------------------------------- 3. TikTok Ads

function tiktokAds() {
  const headers = [
    "Date", "Campaign name", "Ad group name", "Ad name", "Impressions", "Clicks",
    "CTR (%)", "CPC (THB)", "CPM (THB)", "Cost (THB)", "Conversions",
    "Cost per conversion (THB)", "Complete payment ROAS",
  ];
  // TikTok skews younger/cheaper — scale the shared series rather than invent new
  // numbers. Only the campaigns flagged `tiktok` run on this channel, mirroring a
  // merchant who does not mirror every campaign across platforms.
  const rows = SERIES.filter(({ campaign }) => campaign.tiktok).map(({ date, campaign, m }) => {
    const impressions = Math.round(m.impressions * 0.7);
    const clicks = Math.round(m.clicks * 0.85);
    const cost = m.spend * 0.62;
    const conversions = Math.round(m.conversions * 0.7);
    return [
      iso(date),
      campaign.name.replace("Summer Sale", "TT Summer").replace("Always On", "TT Always On"),
      campaign.adset.replace("AS - ", "AG - "),
      campaign.ad.replace("AD - ", "TT - "),
      impressions, clicks,
      ((clicks / impressions) * 100).toFixed(2),
      money(cost / Math.max(clicks, 1)),
      money((cost / impressions) * 1000),
      money(cost),
      conversions,
      money(cost / Math.max(conversions, 1)),
      (m.roas * 0.88).toFixed(2),
    ];
  });
  write("tiktok/ads-export.csv", toCsv(headers, rows));
}

// -------------------------------------- 4. Shopee income report (THE WEDGE)

function shopeeIncome() {
  const headers = [
    "เลขที่คำสั่งซื้อ", "วันที่ทำรายการ", "SKU", "ชื่อสินค้า", "จำนวน",
    "ราคาขาย", "ส่วนลดผู้ขาย", "ยอดที่ผู้ซื้อชำระ",
    "ค่าคอมมิชชั่น", "ค่าธรรมเนียมการทำรายการ", "ค่าบริการ",
    "ค่าจัดส่งที่ผู้ขายรับผิดชอบ", "ยอดโอนสุทธิ",
  ];

  const rows = [];
  let orderSeq = 0;

  DATES.forEach((date) => {
    // Orders are generated PER CAMPAIGN from that campaign's own conversions, so
    // ad spend, revenue and COGS all attribute back to the same SKU. Random
    // product assignment would destroy per-SKU profitability, which is the
    // single number this whole fixture exists to make computable.
    const todays = SERIES.filter((s) => iso(s.date) === iso(date));
    const basket = [];

    for (const { campaign, m } of todays) {
      const product = PRODUCTS.find((p) => p.sku === campaign.sku);
      const attributed = Math.round(m.conversions * 0.85);
      for (let i = 0; i < attributed; i++) basket.push(product);
      // Organic / cross-sell tail — some SKUs sell without any ad behind them.
      const organic = Math.round(attributed * product.organic * jitter(1, 0.3));
      for (let i = 0; i < organic; i++) {
        basket.push(PRODUCTS[randInt(0, PRODUCTS.length - 1)]);
      }
    }

    for (const product of basket) {
      const qty = rng() < 0.8 ? 1 : 2;
      const gross = product.price * qty;
      const sellerDiscount = rng() < 0.35 ? Math.round(gross * 0.1) : 0;
      const buyerPaid = gross - sellerDiscount;

      // Shopee's fees are the whole reason True Net Profit is invisible to sellers.
      const commission = buyerPaid * 0.0535;
      const transaction = buyerPaid * 0.0321;
      const service = buyerPaid * 0.0214;
      const shipping = rng() < 0.4 ? 15 : 0;
      const settlement = buyerPaid - commission - transaction - service - shipping;

      orderSeq += 1;
      rows.push([
        `26${iso(date).replace(/-/g, "").slice(2)}${String(orderSeq).padStart(5, "0")}`,
        thaiSlash(date),
        product.sku, product.name, qty,
        money(gross), money(sellerDiscount), money(buyerPaid),
        money(commission), money(transaction), money(service),
        money(shipping), money(settlement),
      ]);
    }
  });

  write("shopee/income-report.csv", toCsv(headers, rows));
}

// ------------------------------------------------------- 5. Shopee Ads report

function shopeeAds() {
  const headers = [
    "วันที่", "ชื่อแคมเปญ", "ประเภทโฆษณา", "การแสดงผล", "คลิก",
    "CTR (%)", "ค่าใช้จ่าย (บาท)", "จำนวนคำสั่งซื้อ", "ยอดขายจากโฆษณา (บาท)", "ROAS",
  ];
  const adTypes = ["โฆษณาค้นหาสินค้า", "โฆษณาค้นหาร้านค้า", "โฆษณาแนะนำสินค้า"];
  const rows = DATES.map((date, i) => {
    const base = SERIES.find((s) => iso(s.date) === iso(date));
    const impressions = Math.round(base.m.impressions * 0.42);
    const clicks = Math.round(base.m.clicks * 0.55);
    const cost = base.m.spend * 0.38;
    const orders = Math.round(base.m.conversions * 0.6);
    const sales = orders * 520;
    return [
      thaiSlash(date),
      "Shopee Ads - สินค้าขายดี",
      adTypes[i % adTypes.length],
      impressions, clicks,
      ((clicks / impressions) * 100).toFixed(2),
      money(cost), orders, money(sales),
      (sales / Math.max(cost, 1)).toFixed(2),
    ];
  });
  write("shopee/ads-report.csv", toCsv(headers, rows));
}

// --------------------------------------------------- 6. Product cost (COGS)

function productsCogs() {
  const headers = ["SKU", "ชื่อสินค้า", "ต้นทุนสินค้าต่อชิ้น", "ราคาขายตั้งต้น", "หน่วย"];
  const rows = PRODUCTS.map((p) => [p.sku, p.name, money(p.cogs), money(p.price), "ชิ้น"]);
  write("shopee/products-cogs.csv", toCsv(headers, rows));
}

// ------------------------------------------------------------ 7. Edge cases

function edgeCases() {
  const headers = [
    "Reporting starts", "Campaign name", "Ad name",
    "Impressions", "Link clicks", "Amount spent (THB)", "Results",
  ];

  // Every row below is a distinct failure mode the validate stage must catch
  // and route to import_row_errors rather than reject the whole file.
  const rows = [
    ["2026-07-01", "Valid Campaign", "AD - Good", 10000, 160, "496.00", 7],   // ok — must survive
    ["",           "Missing Date",   "AD - A",    12000, 180, "560.00", 8],   // required field empty
    ["31/02/2569", "Impossible Date","AD - B",     9000, 140, "430.00", 6],   // 31 Feb does not exist
    ["2026-07-04", "Negative Impr",  "AD - C",    -5000, 100, "310.00", 4],   // negative metric
    ["2026-07-05", "Bad Number",     "AD - D",    11000, "N/A", "480.00", 5], // non-numeric
    ["2026-07-06", "Clicks > Impr",  "AD - E",      800, 1200, "372.00", 3],  // logically impossible
    ["2026-07-07", "Valid Campaign", "AD - Good2", 10500, 170, "527.00", 7],  // ok — must survive
    ["2026-07-07", "Valid Campaign", "AD - Good2", 10500, 170, "527.00", 7],  // exact duplicate
    ["2026-07-08", "Short Row",      "AD - F"],                               // missing columns
    ["2026-07-09", "Zero Spend",     "AD - G",     4000,  60, "0.00",   0],   // valid but division-by-zero bait
  ];
  write("edge-cases/broken-rows.csv", toCsv(headers, rows));

  // Structural edge cases.
  write("edge-cases/headers-only.csv", toCsv(headers, []));
  write("edge-cases/empty.csv", "");
}

// ---------------------------------------------------------------------- main

console.log("Generating merchant-upload fixtures…\n");
metaClean();
metaThaiDirty();
tiktokAds();
shopeeIncome();
shopeeAds();
productsCogs();
edgeCases();
console.log(`\nDone. Window ${iso(DATES[0])} → ${iso(DATES.at(-1))}, seed ${SEED}.`);
