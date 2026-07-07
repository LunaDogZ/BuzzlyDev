# BUZZLY — Project Context (Canonical Source of Truth)

> Synthesized from: Business Model Canvas, Value Proposition Canvas, and Empathy Map (July 2026).
> Purpose: shared context so every AI agent (Claude Code, Gemini CLI, etc.) understands Buzzly the same way.
> If any other doc conflicts with this file, this file wins unless the founder says otherwise.

---

## 1. What Buzzly Is (One Paragraph)

Buzzly is a **Unified Marketing Data Platform (SaaS)** for Thai D2C merchants. It aggregates advertising and sales data from **Facebook Ads, TikTok Ads, and Shopee** into a single dashboard, and — critically — calculates **Real-time True Net Profit** after Shopee's dynamic platform fees, per SKU. It is NOT a social media platform, NOT a generic analytics tool, and NOT an ad manager.

**Value proposition (verbatim):** "One-click marketing and profit consolidation — eliminating platform-switching and the manual spreadsheet grind."

---

## 2. The Differentiating Wedge (what no one else does)

**Real-time True Net Profit** — calculated after Shopee's dynamic platform fees, not vanity ROAS. It is the only metric that tells a Thai seller whether they are actually making money *today*.

Everything else in the product exists to support or amplify this wedge. When prioritizing features, the wedge always wins.

**Moat:** historical per-SKU margin datasets + a proprietary localized (Thai e-commerce) data-cleaning pipeline that competitors cannot instantly replicate.

---

## 3. Target User (Primary Persona: "The Scaling Omnichannel Operator")

- **Who:** Thai D2C merchant / SME / brand owner, solo or lean team (1–5 people), runs their own paid acquisition daily.
- **Qualifying gate:** ฿3K–฿50K/month active ad spend.
- **Channel stack:** sells on Shopee (subject to dynamic platform fees) while driving traffic via Meta + TikTok ads.
- **Core pain:** high revenue but **invisible true net profit**. Fears scaling ad spend on negative-margin SKUs. Lives in tab-switching + manual Excel reconciliation.
- **Buying behavior:** self-serve, fast decision, no procurement cycle. ROI judged in **hours saved + profit protected**.

### What they say (voice of customer — use these in copy/UX)
- "Sales are good, but why is there no money left?"
- "I waste so much time building Excel reports every month-end."
- "I don't know which channel to put my budget on."
- "I just want one place to see everything, no tab-switching."

### What they think & feel
- **Pains:** fear that high sales actually hide a loss; anxiety about scaling ad budget on negative-margin SKUs; stress from hidden backend costs.
- **Gains:** peace of mind knowing real monthly profit; deciding with data, not guesswork; looking professional/credible to partners and clients.

### What they do today (the behavior we replace)
- Open multiple platform tabs daily (FB, TikTok, Shopee) to check data.
- Pull numbers into Excel and build reports by hand.
- Adjust ad budget based on sentiment and topline sales figures (not profit).

---

## 4. Jobs To Be Done (from VPC)

| Type | Top jobs |
|---|---|
| **Functional** | Consolidate multi-platform marketing data in one click; compare cross-platform metrics in a unified chart; generate marketing reports instantly |
| **Emotional** | Eliminate daily anxiety over actual profitability; gain confidence in data-backed decisions; peace of mind against hidden backend costs |
| **Social** | Be seen as a data-driven operator, not a gut-feeling seller; appear professional and credible to partners |
| **Supporting** | No-code onboarding with seamless API integration; a stable platform with reliable pipelines; evaluate subscription ROI by hours saved |

### Customer pains → Buzzly pain relievers (mapping)
| Customer pain | Buzzly answer |
|---|---|
| High sales, negative profit discovered too late | True Net Profit engine factoring dynamic Shopee fees |
| Scaling budget on negative-margin products | Per-SKU profit resolution |
| Platform-switching tax (multiple tabs) | Unified FB + TikTok + Shopee view |
| Manual spreadsheet calculation errors | Automated API data ingestion |
| Ad spend silently eating margin | Live Blended ROAS vs. total revenue |

### Gain creators
1. **AI Budget Optimization** — channel reallocation modeling on live margin data (**core now, not "Phase 2"**).
2. **Proactive Margin Alerts** — auto-warn the moment ad spend starts cannibalizing net profit.
3. **One-click cross-channel reports** — share-ready for partners/clients.
4. **Historical ad performance ranking** — cost-vs-quality over time.
5. **High-density Bento-grid dashboard** — single source of truth, scannable in seconds.

---

## 5. Product Architecture (business-level)

- **Core platform:** Cloud-based omnichannel analytics SaaS (web-first).
- **Core modules:**
  1. One-Click Platform Data Connectors (FB, TikTok, Shopee APIs)
  2. Unified Cross-Channel Blended ROAS Engine
  3. High-Density Unified Dashboard (Bento Grid UI)
  4. One-Click Automated Marketing Report Generator
- **Supporting services:** no-code fast onboarding, stable & secure data pipeline management, guided automated onboarding, customer tech support.

---

## 6. Pricing & Plans (current — supersedes older 790/1,990/5,990 pricing)

| | **Starter ฿390/mo** | **Pro ฿990/mo** | **Agency ฿2,990/mo** |
|---|---|---|---|
| Brands | 1 | 3 | 10 seats, multi-store |
| SKUs | ≤50 | Unlimited + **True Net Profit** | Unlimited |
| History | 30 days | 180 days | 365 days |
| APIs | connect all | connect all | webhook + API |
| AI features | — | AI Budget Optimization 50 queries/mo | 150 queries/mo |
| Support | self-serve + community | priority async | priority async SLA |

**Key gating insight:** True Net Profit (the wedge) is gated at **Pro** — Starter is the hook, Pro is the product.

---

## 7. Business Model Summary

- **Customer relationships:** fully automated onboarding, lifecycle emails, feature-driven loyalty, AI support + in-app help center, 14-day trials, peer-to-peer community. (PLG — product-led growth, no sales team.)
- **Channels:** direct outreach; build-in-public content on Facebook/TikTok/IG/YouTube; intent-based SEO; in-app referrals.
- **Key partnerships:**
  - Tier 1 (existential): Shopee Open Platform, Meta for Developers, TikTok for Business API
  - Tier 2 (swappable infra): Supabase (PostgreSQL), AWS, Datadog & Sentry, Omise & PromptPay API
  - Tier 3 (growth leverage): KOLs/e-commerce coaches, performance marketing agencies, Shopee/TikTok seller FB groups
- **Key resources:** aggregated per-SKU margin dataset + localized data-cleaning IP (intellectual); core codebase + verified API integrations (technology); solo founder full-stack + Claude Code AI co-pilot (human & AI leverage).
- **Key activities:** API & core engine management, data pipeline & cleaning optimization, AI feature ops, PLG acquisition & churn-save automation, batched content marketing, partnership onboarding & API verifications.

---

## 8. Unit Economics & Financials

- **One-time upfront:** ฿13,000–25,000 (Thai Co. registration ฿8–15K, legal/PDPA templates ฿5–10K; dev registrations free).
- **Fixed cost/month:** ฿28,000 total (Claude Code Pro ฿700, Supabase Pro ฿850, AWS ฿350, Sentry+Datadog ฿1,000, domain/tools ฿500, founder runway ฿25,000).
- **Variable cost per active sub:** Starter ≈฿24 · Pro ≈฿121 · Agency ≈฿344 (Omise fee 3.65% + ฿10, AI call costs).
- **Unit economics:** ARPU ฿920/mo (mix 45/45/10 Starter/Pro/Agency), variable ≈฿100/user → contribution margin ≈฿820/user, gross margin ≈89%.
- **Break-even:** infra only ~4 users · lean (infra+salary ฿28K) ~34 users · realistic (฿43K) ~52 users.
- **Startup capital:** lean ≈฿181K · realistic ≈฿412K.

---

## 9. Constraints & Non-Negotiables for AI Agents

1. **Buzzly = Unified Marketing Data Platform.** Never describe it as a "social media platform" or generic BI tool.
2. **True Net Profit is the wedge.** Feature decisions, copy, and dashboard hierarchy must foreground profit-after-fees, not ROAS vanity metrics.
3. **Persona is fixed:** Thai D2C solo/lean merchant, ฿3K–50K/mo ad spend, Shopee + Meta + TikTok. Do not design for enterprises.
4. **Solo founder + AI leverage.** Every solution must be maintainable by one person; prefer automation, batching, and managed services over ops burden.
5. **Self-serve PLG.** No flows that assume a sales call or manual onboarding.
6. **Thai market context matters:** dynamic Shopee fees, PromptPay/Omise payments, Thai-language sellers, PDPA compliance.
7. **ROI framing for users = hours saved + profit protected.** Use this in UX copy and marketing.
