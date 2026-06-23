import React from 'react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, DollarSign, Activity, Star, Users, Tag, Award } from "lucide-react";

// Loosely-typed shapes for the subset of owner-metric fields this report renders.
// All optional + defensively accessed, so partial/missing data degrades gracefully.
interface ReportKPIs {
    currentMrr?: number;
    previousMrr?: number;
    mrrGrowth?: number;
    arr?: number;
    breakdown?: { newMrr?: number; expansion?: number; churn?: number };
}
interface ReportSubscriptionMetrics extends ReportKPIs {
    timeRangeData?: Record<string, ReportKPIs>;
}
interface ReportProductUsageMetrics {
    mau?: number;
    dau?: number;
    dauMauRatio?: number;
}
interface ReportAARRRStage {
    name: string;
    value: number;
    percentage: number;
}
interface ReportFeedbackMetrics {
    npsScore?: number;
    avgRating?: number;
}
interface ReportTierRow {
    name: string;
    revenue: number;
    avgSpend: number;
}
interface ReportTierMetrics {
    totalCustomers?: number;
    avgSpendAll?: number;
    platinumCount?: number;
    revenueByTier?: ReportTierRow[];
    tierDistribution?: { name: string; value: number; color: string }[];
}
interface ReportDiscount {
    id: string;
    code: string;
    is_active: boolean;
    collections_count: number;
}

interface ExecutiveReportDocumentProps {
    data: {
        subscriptionMetrics?: ReportSubscriptionMetrics;
        feedbackMetrics?: ReportFeedbackMetrics;
        productUsageMetrics?: ReportProductUsageMetrics;
        aarrrMetrics?: ReportAARRRStage[];
        tierMetrics?: ReportTierMetrics;
        discounts?: ReportDiscount[];
    };
    selectedMetrics: string[];
    dateRange: string;
}

export const ExecutiveReportDocument = React.forwardRef<HTMLDivElement, ExecutiveReportDocumentProps>(
    ({ data, selectedMetrics, dateRange }, ref) => {
        const { subscriptionMetrics, feedbackMetrics, productUsageMetrics, aarrrMetrics, tierMetrics, discounts } = data;

        // Safe Math & Fallbacks
        const safeNumber = (val) => (typeof val === 'number' && !isNaN(val)) ? val : 0;
        
        const calculatePercentChange = (current: number, previous: number) => {
            const c = safeNumber(current);
            const p = safeNumber(previous);
            return p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100;
        };

        // Formatters
        const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(safeNumber(val));
        const formatNumber = (val) => new Intl.NumberFormat('en-US').format(safeNumber(val));

        const hasMetric = (id: string) => selectedMetrics.includes(id);

        // Safe Data Extraction for Subscription Metrics
        const getTimeRangeKey = (range: string) => {
            if (range === 'last-week') return '7d';
            if (range === 'last-quarter') return '3m';
            if (range === 'last-year') return '1y';
            return '1m'; // default to 1m for last-month and custom
        };

        const subMetrics = subscriptionMetrics?.timeRangeData?.[getTimeRangeKey(dateRange)] || subscriptionMetrics || {};
        const currentMrr = safeNumber(subMetrics?.currentMrr ?? 0);
        const previousMrr = safeNumber(subMetrics?.previousMrr ?? 0);
        // Fallback to recalculating the percent change if the property is missing
        const mrrGrowth = subMetrics?.mrrGrowth !== undefined ? safeNumber(subMetrics.mrrGrowth) : calculatePercentChange(currentMrr, previousMrr);
        const arr = safeNumber(subMetrics?.arr ?? 0);
        const newMrr = safeNumber(subMetrics?.breakdown?.newMrr ?? 0);
        const expansion = safeNumber(subMetrics?.breakdown?.expansion ?? 0);
        const churn = safeNumber(subMetrics?.breakdown?.churn ?? 0);

        // Helpers to process discounts
        const activeDiscounts = discounts?.filter(d => d.is_active) || [];
        const totalUsage = activeDiscounts.reduce((sum, d) => sum + safeNumber(d.collections_count), 0);

        // Page Break component for multi-page reports (supported cleanly when printing/generating PDFs usually)
        const PageBreak = () => <div style={{ height: '2rem', width: '100%', pageBreakAfter: 'always', breakAfter: 'page' }} />;

        return (
            <div
                ref={ref}
                className="bg-white text-slate-900 mx-auto font-sans relative"
                style={{ width: '210mm', minHeight: '297mm', padding: '16mm 20mm', boxSizing: 'border-box' }}
            >
                {/* --- PAGE 1: HEADER & HIGH-LEVEL FINANCIALS --- */}
                <div className="flex items-end justify-between mb-10 pb-6 border-b-2 border-slate-900">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-12 w-12 bg-slate-900 rounded-xl flex items-center justify-center text-white font-bold text-2xl shadow-md">
                                B
                            </div>
                            <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">Executive Briefing</h1>
                        </div>
                        <p className="text-slate-500 font-medium text-lg mt-1">Owner Analytics & Platform Performance</p>
                    </div>
                    <div className="text-right">
                        <Badge variant="outline" className="text-xs px-3 py-1 mb-2 font-bold uppercase tracking-widest border-slate-300 text-slate-600">
                            Confidential
                        </Badge>
                        <p className="text-sm font-semibold text-slate-800">
                            {format(new Date(), 'MMMM dd, yyyy')}
                        </p>
                        <p className="text-xs text-slate-500 uppercase tracking-widest mt-1">
                            Period: {dateRange.replace('-', ' ')}
                        </p>
                    </div>
                </div>

                <div className="space-y-10">

                    {/* 1. BUSINESS PERFORMANCE */}
                    {hasMetric('business') && subscriptionMetrics && (
                        <section>
                            <h2 className="text-2xl font-black text-slate-900 mb-5 flex items-center gap-2 tracking-tight">
                                <DollarSign className="h-6 w-6 text-slate-700" />
                                Business Performance
                            </h2>
                            <div className="grid grid-cols-3 gap-6">
                                <Card className="shadow-sm border-slate-200 bg-slate-50 border-t-4 border-t-slate-800">
                                    <CardContent className="pt-6">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Monthly Recurring Revenue</p>
                                        <div className="text-4xl font-black text-slate-900 tracking-tight">{formatCurrency(currentMrr)}</div>
                                        <p className={`text-sm mt-3 font-semibold flex items-center ${mrrGrowth >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {mrrGrowth >= 0 ? <TrendingUp className="h-4 w-4 mr-1" /> : <TrendingDown className="h-4 w-4 mr-1" />}
                                            {Math.abs(Math.round(mrrGrowth * 10) / 10)}% vs previous
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card className="shadow-sm border-slate-200">
                                    <CardContent className="pt-6">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Annual Run Rate</p>
                                        <div className="text-3xl font-black text-slate-800 tracking-tight">{formatCurrency(arr)}</div>
                                        <p className="text-xs mt-3 text-slate-500 font-medium">Projected 12-month value</p>
                                    </CardContent>
                                </Card>

                                <Card className="shadow-sm border-slate-200">
                                    <CardContent className="pt-6">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Net New MRR Flux</p>
                                        <div className="text-2xl font-bold text-slate-800 tracking-tight">{formatCurrency(newMrr)}</div>
                                        <div className="mt-3 flex justify-between text-xs font-semibold">
                                            <span className="text-emerald-600">+Exp: {formatCurrency(expansion)}</span>
                                            <span className="text-rose-600">-Chrn: {formatCurrency(churn)}</span>
                                        </div>
                                    </CardContent>
                                </Card>
                            </div>
                        </section>
                    )}

                    {/* 2. PRODUCT USAGE / ENGAGEMENT */}
                    {hasMetric('product') && productUsageMetrics && (
                        <section>
                            <h2 className="text-2xl font-black text-slate-900 mb-5 flex items-center gap-2 tracking-tight">
                                <Activity className="h-6 w-6 text-slate-700" />
                                Product Usage & Engagement
                            </h2>
                            <div className="grid grid-cols-2 gap-8">
                                <div className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Monthly Active Users</p>
                                            <p className="text-3xl font-black tracking-tight text-slate-900">{formatNumber(productUsageMetrics.mau)}</p>
                                        </div>
                                        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Daily Active Users</p>
                                            <p className="text-3xl font-black tracking-tight text-slate-900">{formatNumber(productUsageMetrics.dau)}</p>
                                        </div>
                                    </div>
                                    <div className="bg-slate-900 rounded-xl p-5 shadow-inner flex items-center justify-between text-white">
                                        <div>
                                            <p className="font-bold">DAU / MAU Ratio</p>
                                            <p className="text-xs text-slate-400 mt-1">Stickiness indicator</p>
                                        </div>
                                        <div className="text-3xl font-black">{productUsageMetrics.dauMauRatio}%</div>
                                    </div>
                                </div>

                                {aarrrMetrics && (
                                    <Card className="shadow-sm border-slate-200">
                                        <CardHeader className="pb-2 bg-slate-50 rounded-t-xl border-b border-slate-100">
                                            <CardTitle className="text-xs font-bold text-slate-600 uppercase tracking-wider">AARRR Funnel Health</CardTitle>
                                        </CardHeader>
                                        <CardContent className="space-y-3 pt-4">
                                            {aarrrMetrics.map((stage, idx) => (
                                                <div key={stage.name} className="relative">
                                                    <div className="flex justify-between text-xs font-bold mb-1 text-slate-700">
                                                        <span className="uppercase">{stage.name}</span>
                                                        <span>{formatNumber(stage.value)} ({stage.percentage}%)</span>
                                                    </div>
                                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-slate-900 rounded-full"
                                                            style={{ width: `${stage.percentage}%`, opacity: 1 - (idx * 0.15) }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </CardContent>
                                    </Card>
                                )}
                            </div>
                        </section>
                    )}

                    {/* PAGE BREAK MAY OCCUR AROUND HERE DEP. ON DATA */}
                    {(hasMetric('tiers') || hasMetric('feedback') || hasMetric('discounts')) && <PageBreak />}

                    {/* 3. CUSTOMER TIERS */}
                    {hasMetric('tiers') && tierMetrics && (
                        <section className="pt-2">
                            <h2 className="text-2xl font-black text-slate-900 mb-5 flex items-center gap-2 tracking-tight">
                                <Award className="h-6 w-6 text-slate-700" />
                                Customer Loyalty Tiers
                            </h2>
                            <div className="grid grid-cols-3 gap-6 mb-6">
                                <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Total Loyal Customers</p>
                                    <p className="text-3xl font-black tracking-tight text-slate-900">{formatNumber(tierMetrics.totalCustomers)}</p>
                                </div>
                                <div className="bg-white border border-slate-200 p-5 rounded-xl shadow-sm text-center">
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Avg Spend</p>
                                    <p className="text-3xl font-black tracking-tight text-slate-900">{formatCurrency(tierMetrics.avgSpendAll)}</p>
                                </div>
                                <div className="bg-gradient-to-br from-indigo-500 to-purple-600 text-white p-5 rounded-xl shadow-sm border border-indigo-400 text-right">
                                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-100 mb-1">Platinum VIPs</p>
                                    <p className="text-3xl font-black tracking-tight">{formatNumber(tierMetrics.platinumCount)}</p>
                                </div>
                            </div>

                            <Card className="shadow-sm border-slate-200">
                                <CardContent className="p-0">
                                    <table className="w-full text-left text-sm">
                                        <thead className="bg-slate-50 text-slate-500 uppercase font-bold text-[10px] tracking-wider border-b border-slate-200 rounded-t-xl">
                                            <tr>
                                                <th className="p-4 rounded-tl-xl">Tier Level</th>
                                                <th className="p-4">Customers</th>
                                                <th className="p-4">Total Revenue</th>
                                                <th className="p-4 text-right rounded-tr-xl">Avg Spend</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {tierMetrics.revenueByTier?.map((tier, i: number) => {
                                                const dist = tierMetrics.tierDistribution?.find((d) => d.name === tier.name);
                                                return (
                                                    <tr key={tier.name} className="border-b border-slate-100 last:border-0">
                                                        <td className="p-4 font-bold text-slate-800 flex items-center gap-2">
                                                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: dist?.color || '#ccc' }} />
                                                            {tier.name}
                                                        </td>
                                                        <td className="p-4 font-medium text-slate-600">{formatNumber(dist?.value || 0)}</td>
                                                        <td className="p-4 font-medium text-slate-600">{formatCurrency(tier.revenue)}</td>
                                                        <td className="p-4 font-medium text-slate-600 text-right">{formatCurrency(tier.avgSpend)}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </CardContent>
                            </Card>
                        </section>
                    )}

                    <div className="grid grid-cols-2 gap-8 pt-4">
                        {/* 4. DISCOUNTS & MARKETING */}
                        {hasMetric('discounts') && (
                            <section>
                                <h2 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2 tracking-tight">
                                    <Tag className="h-5 w-5 text-slate-700" />
                                    Promotions
                                </h2>
                                <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                                    <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                                        <div>
                                            <p className="text-3xl font-black text-slate-900">{activeDiscounts.length}</p>
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Campaigns</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-3xl font-black text-slate-900">{formatNumber(totalUsage)}</p>
                                            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Coupons Used</p>
                                        </div>
                                    </div>
                                    <div>
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Top Campaigns</p>
                                        <div className="space-y-2">
                                            {activeDiscounts.sort((a, b) => b.collections_count - a.collections_count).slice(0, 3).map(d => (
                                                <div key={d.id} className="flex justify-between items-center text-sm">
                                                    <span className="font-bold text-slate-700">{d.code}</span>
                                                    <span className="bg-slate-100 px-2 py-0.5 rounded text-xs font-semibold text-slate-600">{d.collections_count} uses</span>
                                                </div>
                                            ))}
                                            {activeDiscounts.length === 0 && <span className="text-sm text-slate-400 italic">No active campaigns</span>}
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}

                        {/* 5. USER FEEDBACK / SENTIMENT */}
                        {hasMetric('feedback') && feedbackMetrics && (
                            <section>
                                <h2 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2 tracking-tight">
                                    <Star className="h-5 w-5 text-slate-700" />
                                    User Sentiment
                                </h2>
                                <div className="space-y-4">
                                    <div className="bg-slate-900 text-white rounded-xl p-5 shadow-sm">
                                        <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Net Promoter Score (NPS)</p>
                                        <div className="flex items-baseline gap-2">
                                            <p className="text-4xl font-black tracking-tight">{feedbackMetrics.npsScore}</p>
                                            <Badge variant="outline" className={`ml-2 border-slate-600 ${feedbackMetrics.npsScore > 30 ? "text-emerald-400" : "text-slate-300"}`}>
                                                {feedbackMetrics.npsScore > 50 ? 'Excellent' : feedbackMetrics.npsScore > 0 ? 'Good' : 'Needs Work'}
                                            </Badge>
                                        </div>
                                    </div>

                                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col justify-center">
                                        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">CSAT Rating</p>
                                        <div className="flex items-center gap-3">
                                            <p className="text-3xl font-black tracking-tight text-slate-900">{feedbackMetrics.avgRating}</p>
                                            <div className="flex gap-0.5">
                                                {[...Array(5)].map((_, i) => (
                                                    <Star key={i} className={`h-5 w-5 ${i < Math.round(feedbackMetrics.avgRating) ? 'fill-amber-400 text-amber-400' : 'fill-slate-100 text-slate-200'}`} />
                                                ))}
                                            </div>
                                            <span className="text-xs ml-auto font-bold text-slate-400">/ 5.0</span>
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>

                </div>

                {/* Footer Area - Absolute positioning to guarantee placement at bottom of A4 if single page, 
            but using standard flow for multi-page ensures it renders at end */}
                <div className="mt-16 pt-6 border-t font-semibold border-slate-200 flex justify-between items-center text-slate-400 text-xs">
                    <p>© {new Date().getFullYear()} Buzzly Analytics Suite. Highly Confidential.</p>
                    <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        System Status: Verified
                    </div>
                </div>

            </div>
        );
    }
);

ExecutiveReportDocument.displayName = 'ExecutiveReportDocument';
