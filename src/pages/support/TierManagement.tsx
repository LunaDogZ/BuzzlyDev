import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  Search,
  History,
  Edit,
  Clock,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Settings2,
  Play,
  MoreVertical,
  CheckCircle,
  Slash,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tierColors, tierIcons } from "@/hooks/useLoyaltyTier";
import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import {
  usePointsTransactions,
  useSuspiciousActivities,
  useCustomerSearch,
  useManualTierOverride,
  useLoyaltyTierHistoryAll,
  useAllCustomers,
  useLoyaltyTiers,
  useUpdateTierRetention,
  useEvaluateInactivityDowngrades,
  useSyncTierFromLifetimePoints,
  ADMIN_PAGE_SIZE,
  ALERTS_PAGE_SIZE,
  type CustomerSearchResult,
  type LoyaltyTierHistoryEntry,
  type SuspiciousActivity,
} from "@/hooks/useTierManagement";

/** Tier priority for rise/drop indicator (higher = better) */
const TIER_PRIORITY: Record<string, number> = {
  Bronze: 1,
  Silver: 2,
  Gold: 3,
  Platinum: 4,
};

/** Resolve priority for any tier name (handles "Bronze New Tier" etc.) */
const getTierPriority = (tierName: string, tierRules: { name: string; priority_level: number | null }[]) => {
  const exact = TIER_PRIORITY[tierName];
  if (exact != null) return exact;
  const fromRules = tierRules.find((t) => t.name === tierName);
  if (fromRules?.priority_level != null) return fromRules.priority_level;
  if (tierName.toLowerCase().includes("bronze")) return 1;
  if (tierName.toLowerCase().includes("silver")) return 2;
  if (tierName.toLowerCase().includes("gold")) return 3;
  if (tierName.toLowerCase().includes("platinum")) return 4;
  return 0;
};

const defaultTierColors: Record<string, { bg: string; text: string; border: string }> = {
  Bronze: { bg: "bg-amber-700/20", text: "text-amber-700", border: "border-amber-700" },
  Silver: { bg: "bg-slate-400/20", text: "text-slate-500", border: "border-slate-400" },
  Gold: { bg: "bg-yellow-500/20", text: "text-yellow-600", border: "border-yellow-500" },
  Platinum: { bg: "bg-slate-300/20", text: "text-slate-600", border: "border-slate-400" },
};
const defaultTierIcons: Record<string, string> = {
  Bronze: "🥉", Silver: "🥈", Gold: "🥇", Platinum: "💎",
};

/** Resolve icon for any tier name (handles "Bronze New Tier" etc.) */
const getTierIcon = (tierName: string, icons: Record<string, string>) =>
  icons[tierName] ?? (tierName.toLowerCase().includes("bronze") ? "🥉" : tierName.toLowerCase().includes("silver") ? "🥈" : tierName.toLowerCase().includes("gold") ? "🥇" : tierName.toLowerCase().includes("platinum") ? "💎" : "👤");

/** Resolve badge class for any tier name */
const getTierBadgeClass = (
  tier: string,
  colors: Record<string, { bg: string; text: string }>
) => {
  const base = tier.toLowerCase().includes("bronze") ? "Bronze" : tier.toLowerCase().includes("silver") ? "Silver" : tier.toLowerCase().includes("gold") ? "Gold" : tier.toLowerCase().includes("platinum") ? "Platinum" : tier;
  return cn(
    "rounded-full border-none font-medium",
    colors[base]?.bg ?? colors[tier]?.bg ?? "bg-slate-100",
    colors[base]?.text ?? colors[tier]?.text ?? "text-slate-600"
  );
};

import { useQueryClient } from "@tanstack/react-query";
import type { LoyaltyTierRule } from "@/hooks/useTierManagement";

const TierRuleRow = ({
  tier,
  safeTierIcons,
  safeTierColors,
  onSave,
  isPending,
}: {
  tier: LoyaltyTierRule;
  safeTierIcons: Record<string, string>;
  safeTierColors: Record<string, { bg: string; text: string; border: string }>;
  onSave: (days: number) => void;
  isPending: boolean;
}) => {
  const [editDays, setEditDays] = useState<string>(String(tier.retention_period_days ?? 90));
  const hasChange = Number(editDays) !== (tier.retention_period_days ?? 90);
  const validDays = (d: number) => d >= 30 && d <= 365;
  const handleSave = () => {
    const n = Number(editDays);
    if (validDays(n)) onSave(n);
  };
  return (
    <TableRow className="border-b border-slate-50">
      <TableCell className="py-4">
        <span className="mr-2">{getTierIcon(tier.name, safeTierIcons) ?? "👤"}</span>
        <Badge className={cn(
          "rounded-full border-none",
          safeTierColors[tier.name]?.bg ?? (tier.name.toLowerCase().includes("bronze") ? safeTierColors.Bronze?.bg : tier.name.toLowerCase().includes("silver") ? safeTierColors.Silver?.bg : tier.name.toLowerCase().includes("gold") ? safeTierColors.Gold?.bg : tier.name.toLowerCase().includes("platinum") ? safeTierColors.Platinum?.bg : "bg-slate-100"),
          safeTierColors[tier.name]?.text ?? (tier.name.toLowerCase().includes("bronze") ? safeTierColors.Bronze?.text : tier.name.toLowerCase().includes("silver") ? safeTierColors.Silver?.text : tier.name.toLowerCase().includes("gold") ? safeTierColors.Gold?.text : tier.name.toLowerCase().includes("platinum") ? safeTierColors.Platinum?.text : "text-slate-600")
        )}>
          {tier.name}
        </Badge>
      </TableCell>
      <TableCell className="py-4">{(tier.min_points ?? 0).toLocaleString()}</TableCell>
      <TableCell className="py-4">
        <Input
          type="number"
          min={30}
          max={365}
          value={editDays}
          onChange={(e) => setEditDays(e.target.value)}
          className="w-24"
        />
      </TableCell>
      <TableCell className="py-4">
        <Button
          size="sm"
          variant="outline"
          disabled={!hasChange || !validDays(Number(editDays)) || isPending}
          onClick={handleSave}
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
        </Button>
      </TableCell>
    </TableRow>
  );
};

export default function TierManagement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSearchResult | null>(null);
  const [overrideDialogOpen, setOverrideDialogOpen] = useState(false);
  const [overrideTier, setOverrideTier] = useState("");
  const [overrideReason, setOverrideReason] = useState("");

  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [godCustomerSearch, setGodCustomerSearch] = useState("");
  const [godCustomerId, setGodCustomerId] = useState("");
  const [godTier, setGodTier] = useState("");
  const [godReason, setGodReason] = useState("");
  const [godDropdownOpen, setGodDropdownOpen] = useState(false);

  const [activeTab, setActiveTab] = useState("rules");
  const [historyPage, setHistoryPage] = useState(0);
  const [loyaltyHistoryPage, setLoyaltyHistoryPage] = useState(0);
  const [transactionsPage, setTransactionsPage] = useState(0);
  const [activitiesPage, setActivitiesPage] = useState(0);
  const [alertTypeFilter, setAlertTypeFilter] = useState("all");
  const [alertSeverityFilter, setAlertSeverityFilter] = useState("all");
  const [alertStatusFilter, setAlertStatusFilter] = useState("all");

  const { data: loyaltyTierHistoryAll = [], isLoading: loyaltyHistoryLoading, isError: loyaltyHistoryError, error: loyaltyHistoryErrorDetail, refetch: refetchLoyaltyHistory } = useLoyaltyTierHistoryAll();
  const { data: pointsTransactions = [], isLoading: txLoading, isError: txError, error: txErrorDetail } = usePointsTransactions(transactionsPage);
  const { data: suspiciousActivities = [] as SuspiciousActivity[], isLoading: alertsLoading, unresolvedCount, resolveActivity } = useSuspiciousActivities(activitiesPage, {
    type: alertTypeFilter,
    severity: alertSeverityFilter,
    status: alertStatusFilter
  });
  const { query: searchQuery, setQuery: setSearchQuery, data: searchResults = [], isFetching: searchLoading, isError: searchError, error: searchErrorDetail } = useCustomerSearch();
  const { data: adjustSearchResults = [], isFetching: adjustSearchLoading } = useCustomerSearch(
    adjustDialogOpen && godCustomerSearch ? godCustomerSearch : ""
  );
  const manualOverride = useManualTierOverride();
  const { data: allCustomers = [], isLoading: allCustomersLoading } = useAllCustomers();
  const { data: tierRules = [], isLoading: tierRulesLoading } = useLoyaltyTiers();
  const updateRetention = useUpdateTierRetention();
  const evaluateDowngrades = useEvaluateInactivityDowngrades();
  const syncTierHistory = useSyncTierFromLifetimePoints();

  const safeTierIcons = tierIcons || defaultTierIcons;
  const safeTierColors = tierColors || defaultTierColors;
  const safeLocale = enUS;

  const isFiltered = alertTypeFilter !== "all" || alertSeverityFilter !== "all" || alertStatusFilter !== "all";

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "bg-destructive text-destructive-foreground";
      case "high": return "bg-orange-500 text-white";
      case "medium": return "bg-yellow-500 text-white";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getTransactionTypeColor = (type: string) => {
    switch (type) {
      case "earn": return "text-green-600";
      case "bonus": return "text-blue-600";
      case "spend": return "text-orange-600";
      case "adjustment": return "text-destructive";
      default: return "text-foreground";
    }
  };

  const handleManualOverride = async () => {
    if (!selectedCustomer || !overrideTier || !overrideReason.trim()) return;
    try {
      await manualOverride.mutateAsync({
        userId: selectedCustomer.id,
        newTierName: overrideTier,
        reason: overrideReason,
      });
      setOverrideDialogOpen(false);
      setOverrideTier("");
      setOverrideReason("");
      queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history-manual"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history"] });
      queryClient.invalidateQueries({ queryKey: ["points-transactions"] });
      toast({ title: "Update Success", description: `Tier updated for ${selectedCustomer.full_name}` });
    } catch (err) {
      toast({ title: "Update Failed", description: (err as Error).message, variant: "destructive" });
    }
  };

  const filteredCustomers = allCustomers.filter((c: { full_name?: string; id: string; email?: string }) => {
    if (!godCustomerSearch.trim()) return true;
    const q = godCustomerSearch.toLowerCase();
    return (
      c.full_name?.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      (c.email && c.email.toLowerCase().includes(q))
    );
  });
  const adjustDropdownCustomers = godCustomerSearch.trim().length >= 1
    ? adjustSearchResults
    : filteredCustomers;
  const godSelectedCustomer = [...adjustSearchResults, ...allCustomers].find((c: { id: string }) => c.id === godCustomerId) ?? null;

  const handleGodOverride = async () => {
    if (!godCustomerId || !godTier || !godReason.trim()) return;
    const tierName = godTier;
    try {
      await manualOverride.mutateAsync({
        userId: godCustomerId,
        newTierName: godTier,
        reason: godReason,
      });
      setGodCustomerId("");
      setGodCustomerSearch("");
      setGodTier("");
      setGodReason("");
      setAdjustDialogOpen(false);
      // Switch to History tab so user sees the new entry immediately
      setActiveTab("history");
      // Force immediate refetch so Tier Change History and customer list show updated tier
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["loyalty-tier-history-all"] }),
        queryClient.refetchQueries({ queryKey: ["customer-search"] }),
        queryClient.refetchQueries({ queryKey: ["all-customers-dropdown"] }),
      ]);
      queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history-manual"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty-tier-history"] });
      queryClient.invalidateQueries({ queryKey: ["points-transactions-admin"] });
      toast({ title: "Tier updated", description: `Changed to ${tierName}`, variant: "default" });
    } catch (err) {
      const msg = (err as Error).message;
      const friendlyMsg = msg?.includes("tier_unchanged") ? "Select a different tier to change" : msg;
      toast({ title: "Update Failed", description: friendlyMsg, variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header with primary action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Tier Management</h1>
          <p className="text-muted-foreground leading-relaxed mt-1">Manage and monitor customer Loyalty Tiers</p>
        </div>
        <Dialog
          open={adjustDialogOpen}
          onOpenChange={(open) => {
            setAdjustDialogOpen(open);
            if (!open) {
              setGodCustomerId("");
              setGodCustomerSearch("");
              setGodTier("");
              setGodReason("");
              setGodDropdownOpen(false);
            }
          }}
        >
          <DialogTrigger asChild>
            <Button
              variant="outline"
              className="border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 shadow-sm text-slate-700 font-medium rounded-xl px-5 py-2.5 h-auto"
            >
              <Edit className="h-4 w-4 mr-2 text-slate-500" />
              Adjust Tier
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[440px] p-0 gap-0 overflow-hidden rounded-2xl">
            <div className="p-6 pb-4 border-b border-slate-100 bg-gradient-to-b from-slate-50 to-white">
              <DialogHeader className="text-left space-y-1.5">
                <DialogTitle className="text-xl font-semibold text-slate-800">Manual Tier Adjustment</DialogTitle>
                <DialogDescription className="text-slate-500 text-sm leading-relaxed mt-1">
                  Select customer and assign new tier — recorded in history with change_type = manual
                </DialogDescription>
              </DialogHeader>
            </div>
            <div className="p-6 pt-4 space-y-5 max-h-[70vh] overflow-y-auto">
              <div className="space-y-2 relative">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-slate-600 text-xs font-semibold">1</span>
                  <Label className="text-slate-700 font-medium">Select customer</Label>
                </div>
                <div className="relative">
                  <Input
                    placeholder={allCustomersLoading ? "Loading customers..." : "Search by name, email, or customer ID..."}
                    value={godCustomerSearch}
                    onChange={(e) => { setGodCustomerSearch(e.target.value); setGodDropdownOpen(true); }}
                    onFocus={() => setGodDropdownOpen(true)}
                    disabled={allCustomersLoading}
                    className="rounded-xl border-slate-200 h-11"
                  />
                  {(allCustomersLoading || (godCustomerSearch.trim().length >= 1 && adjustSearchLoading)) && (
                    <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </div>
                {godDropdownOpen && (godCustomerSearch.length > 0 || adjustDropdownCustomers.length > 0) && (
                  <div className="absolute top-full left-0 w-full mt-1.5 border border-slate-200 rounded-xl max-h-52 overflow-y-auto bg-white shadow-lg z-50">
                    {adjustDropdownCustomers.length === 0 ? (
                      <p className="text-sm text-slate-500 text-center py-4">No customers found</p>
                    ) : (
                      adjustDropdownCustomers.map((c: { id: string; full_name?: string; loyalty_tier?: string; email?: string }) => (
                        <button
                          key={c.id}
                          type="button"
                          className={cn(
                            "w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors text-sm rounded-lg mx-1 my-0.5 first:mt-1 last:mb-1",
                            godCustomerId === c.id && "bg-slate-100 ring-1 ring-slate-200"
                          )}
                          onClick={() => {
                            setGodCustomerId(c.id);
                            setGodCustomerSearch(c.full_name ?? c.id.slice(0, 8));
                            setGodTier(c.loyalty_tier ?? ""); // Pre-select current tier so user must change it
                            setGodDropdownOpen(false);
                          }}
                        >
                          <span className="flex items-center gap-2">
                            <span>{safeTierIcons[c.loyalty_tier ?? ""] ?? "👤"}</span>
                            <span className="truncate">{c.full_name ?? "Unspecified"}</span>
                          </span>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px] rounded-full border-none",
                              (safeTierColors as Record<string, { bg: string; text: string }>)[c.loyalty_tier ?? ""]?.bg,
                              (safeTierColors as Record<string, { bg: string; text: string }>)[c.loyalty_tier ?? ""]?.text
                            )}
                          >
                            {c.loyalty_tier ?? "Bronze"}
                          </Badge>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {godSelectedCustomer && (
                  <div className="flex items-center gap-3 p-4 mt-3 rounded-xl bg-slate-50/80 border border-slate-100">
                    <span className="text-2xl">{getTierIcon(godSelectedCustomer.loyalty_tier ?? "", safeTierIcons)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm leading-snug">{godSelectedCustomer.full_name ?? "Unspecified"}</p>
                      <p className="text-xs text-muted-foreground">
                        {(godSelectedCustomer.loyalty_points_balance ?? 0).toLocaleString()} pts
                      </p>
                    </div>
                    <Badge className={cn("shadow-none", getTierBadgeClass(godSelectedCustomer.loyalty_tier ?? "Bronze", safeTierColors))}>
                      {godSelectedCustomer.loyalty_tier ?? "Bronze"}
                    </Badge>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-slate-600 text-xs font-semibold">2</span>
                  <Label className="text-slate-700 font-medium">New tier</Label>
                </div>
                <Select value={godTier} onValueChange={setGodTier}>
                  <SelectTrigger className="rounded-xl border-slate-200 h-11 bg-white">
                    <SelectValue placeholder="Select new tier" />
                  </SelectTrigger>
                  <SelectContent>
                    {tierRules.map((t) => (
                      <SelectItem key={t.id} value={t.name}>
                        {safeTierIcons[t.name] ?? "👤"} {t.name}
                      </SelectItem>
                    ))}
                    {tierRules.length === 0 && (
                      <>
                        <SelectItem value="Bronze">🥉 Bronze</SelectItem>
                        <SelectItem value="Silver">🥈 Silver</SelectItem>
                        <SelectItem value="Gold">🥇 Gold</SelectItem>
                        <SelectItem value="Platinum">💎 Platinum</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 text-slate-600 text-xs font-semibold">3</span>
                  <Label className="text-slate-700 font-medium">Reason (required)</Label>
                </div>
                <Textarea
                  placeholder="Reason for tier change..."
                  value={godReason}
                  onChange={(e) => setGodReason(e.target.value)}
                  className="rounded-xl border-slate-200 min-h-[88px] resize-none"
                  rows={3}
                />
              </div>
              <div className="pt-2 space-y-1">
                {godTier === (godSelectedCustomer?.loyalty_tier ?? "") && godSelectedCustomer && (
                  <p className="text-xs text-amber-600">Select a different tier to change</p>
                )}
                <Button
                  type="button"
                  className="w-full font-semibold rounded-xl h-12 bg-slate-800 hover:bg-slate-900 text-white shadow-sm"
                  disabled={
                    !godCustomerId ||
                    !godTier ||
                    !godReason.trim() ||
                    manualOverride.isPending ||
                    godTier === (godSelectedCustomer?.loyalty_tier ?? "")
                  }
                  onClick={handleGodOverride}
                >
                  {manualOverride.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Edit className="h-4 w-4 mr-2" />
                  )}
                  Save tier change
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Main content: single white card with search + tabs in same row */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 px-6 py-4 border-b border-slate-100">
            <div className="flex-1 relative min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name, email, or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-10 pl-9 pr-4 rounded-lg text-sm outline-none transition-all border border-slate-200 bg-slate-50/50 focus:border-blue-500 focus:bg-white"
              />
              {searchLoading && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <TabsList className="bg-slate-100/80 p-1 rounded-lg h-auto border border-slate-200/80">
              <TabsTrigger value="rules" className="flex items-center gap-2 rounded-md py-2 px-4 text-sm data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm">
                <Settings2 className="h-4 w-4" /> Tier Rules
              </TabsTrigger>
              <TabsTrigger value="history" className="flex items-center gap-2 rounded-md py-2 px-4 text-sm data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm">
                <History className="h-4 w-4" /> Tier History
              </TabsTrigger>
              <TabsTrigger value="transactions" className="flex items-center gap-2 rounded-md py-2 px-4 text-sm data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm">
                <ArrowUpDown className="h-4 w-4" /> Points
              </TabsTrigger>
              <TabsTrigger value="alerts" className="flex items-center gap-2 rounded-md py-2 px-4 text-sm data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm">
                <AlertTriangle className="h-4 w-4" /> Suspicious {unresolvedCount > 0 && <Badge className="bg-red-500 ml-1 h-5 px-1">{unresolvedCount}</Badge>}
              </TabsTrigger>
            </TabsList>
          </div>

          {searchQuery.length >= 1 && (
            <div className="px-6 py-4 border-b border-slate-100">
              {searchError ? (
                <p className="text-sm text-destructive text-center py-4">
                  Search failed: {(searchErrorDetail as Error)?.message ?? "Please try again"}
                </p>
              ) : searchResults.length === 0 && !searchLoading ? (
                <p className="text-sm text-muted-foreground text-center py-4">No matching customers found</p>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((customer: CustomerSearchResult) => (
                    <div
                      key={customer.id}
                      className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedCustomer(customer)}
                    >
                      <div className="flex items-center gap-4">
                        <div className="text-2xl">{safeTierIcons[customer.loyalty_tier ?? ""] ?? "👤"}</div>
                        <div>
                          <p className="font-medium leading-snug">{customer.full_name ?? "Unspecified"}</p>
                          <p className="text-sm text-muted-foreground">{customer.email}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge className={cn("rounded-full border-none", (safeTierColors as Record<string, { bg: string; text: string }>)[customer.loyalty_tier ?? ""]?.bg ?? "bg-muted", (safeTierColors as Record<string, { bg: string; text: string }>)[customer.loyalty_tier ?? ""]?.text)}>
                          {customer.loyalty_tier ?? "Bronze"}
                        </Badge>
                        <p className="text-sm text-muted-foreground mt-1">
                          {(customer.loyalty_points_balance ?? 0).toLocaleString()} pts
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <TabsContent value="rules" className="m-0">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-800">Tier Rules — Inactivity downgrade period</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                If inactive (no earn/redeem) beyond the set period, tier is downgraded by lifetime points. Active users keep their tier even if points decrease.
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {tierRulesLoading ? (
                <div className="space-y-2 py-8"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => evaluateDowngrades.mutate()}
                      disabled={evaluateDowngrades.isPending}
                    >
                      {evaluateDowngrades.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                      Evaluate inactivity downgrade (run now)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => syncTierHistory.mutate()}
                      disabled={syncTierHistory.isPending}
                    >
                      {syncTierHistory.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <History className="h-4 w-4 mr-2" />}
                      Sync tier history (fix Bronze→Silver)
                    </Button>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b border-slate-100">
                        <TableHead className="bg-transparent">Tier</TableHead>
                        <TableHead className="bg-transparent">Min Points</TableHead>
                        <TableHead className="bg-transparent">Inactivity Downgrade (days)</TableHead>
                        <TableHead className="bg-transparent">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tierRules.map((tier) => (
                        <TierRuleRow
                          key={tier.id}
                          tier={tier}
                          safeTierIcons={safeTierIcons}
                          safeTierColors={safeTierColors}
                          onSave={(days) => updateRetention.mutate({ tierId: tier.id, retentionDays: days })}
                          isPending={updateRetention.isPending}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </>
              )}
            </div>
          </TabsContent>

          {selectedCustomer && (
            <div className="px-6 py-4 border-b border-slate-100">
              <div className="flex flex-row items-center justify-between p-4 rounded-lg bg-slate-50/50 border border-slate-100">
                <div className="flex items-center gap-4">
                  <div className="h-12 w-12 rounded-xl flex items-center justify-center text-2xl bg-white border border-slate-200">
                    {safeTierIcons[selectedCustomer.loyalty_tier ?? ""] ?? "👤"}
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-slate-800 leading-snug">{selectedCustomer.full_name}</p>
                    <p className="text-sm text-slate-500">{selectedCustomer.email}</p>
                  </div>
                </div>
                <Dialog open={overrideDialogOpen} onOpenChange={setOverrideDialogOpen}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm"><Edit className="h-4 w-4 mr-2" /> Manual Override</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Manual Tier Override</DialogTitle>
                      <DialogDescription>Manually change tier for {selectedCustomer.full_name}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label>Current Tier</Label>
                        <div className="flex items-center gap-2">
                          <span className="text-xl">{safeTierIcons[selectedCustomer.loyalty_tier ?? "Bronze"] ?? "—"}</span>
                          <Badge className={cn("rounded-full border-none", safeTierColors[selectedCustomer.loyalty_tier ?? "Bronze"]?.bg ?? "bg-muted", safeTierColors[selectedCustomer.loyalty_tier ?? "Bronze"]?.text)}>
                            {selectedCustomer.loyalty_tier ?? "Bronze"}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label>New Tier</Label>
                        <Select value={overrideTier} onValueChange={setOverrideTier}>
                          <SelectTrigger><SelectValue placeholder="Select new tier" /></SelectTrigger>
                          <SelectContent>
                            {tierRules.map((t) => (
                              <SelectItem key={t.id} value={t.name}>
                                {safeTierIcons[t.name] ?? "👤"} {t.name}
                              </SelectItem>
                            ))}
                            {tierRules.length === 0 && (
                              <>
                                <SelectItem value="Bronze">🥉 Bronze</SelectItem>
                                <SelectItem value="Silver">🥈 Silver</SelectItem>
                                <SelectItem value="Gold">🥇 Gold</SelectItem>
                                <SelectItem value="Platinum">💎 Platinum</SelectItem>
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Reason for change</Label>
                        <Textarea
                          placeholder="Specify reason..."
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setOverrideDialogOpen(false)}>Cancel</Button>
                      <Button onClick={handleManualOverride} disabled={!overrideTier || !overrideReason.trim() || manualOverride.isPending}>
                        {manualOverride.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save Changes
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
                {[
                  { label: "Points", value: (selectedCustomer.loyalty_points_balance ?? 0).toLocaleString() },
                  { label: "Total Spend", value: `฿ ${(selectedCustomer.total_spend ?? 0).toLocaleString()}` },
                  { label: "Member Duration", value: `${selectedCustomer.created_at ? Math.floor((Date.now() - new Date(selectedCustomer.created_at).getTime()) / (1000 * 60 * 60 * 24 * 30)) : 0} months` },
                  { label: "Current Tier", value: selectedCustomer.loyalty_tier ?? "Bronze" },
                ].map((stat, i) => (
                  <div key={i} className="rounded-lg p-3 bg-white border border-slate-100">
                    <p className="text-lg font-semibold text-slate-800 leading-snug">{stat.value}</p>
                    <p className="text-xs font-medium uppercase tracking-wider text-slate-400 mt-0.5">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <TabsContent value="history" className="m-0">
            {/* Tier Change History - unified table with Origin */}
            <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-800">Tier Change History</h3>
                <p className="text-sm text-muted-foreground mt-0.5">Only shows actual tier changes (Previous ≠ New Tier)</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => syncTierHistory.mutate()}
                disabled={syncTierHistory.isPending}
              >
                {syncTierHistory.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <History className="h-4 w-4 mr-2" />}
                Sync tier history
              </Button>
            </div>
            <div className="px-6 pb-6 min-h-[520px]">
              {loyaltyHistoryLoading ? (
                <div className="space-y-2 py-8"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
              ) : loyaltyHistoryError ? (
                <div className="py-16 text-center space-y-3">
                  <p className="text-destructive font-medium">Failed to load tier history</p>
                  <p className="text-sm text-muted-foreground max-w-md mx-auto">
                    {(loyaltyHistoryErrorDetail as Error)?.message ?? "Check RLS: ensure you are logged in as Support/Owner/Dev with status=active, approval_status=approved in employees table."}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => refetchLoyaltyHistory()}>
                    Retry
                  </Button>
                </div>
              ) : (() => {
                const displayOld = (t: string | null | undefined) =>
                  (t === null || t === "" || t === "None") ? "—" : t;
                const withActualChange = loyaltyTierHistoryAll.filter(
                  (h: LoyaltyTierHistoryEntry) => displayOld(h.old_tier) !== (h.new_tier ?? "")
                );
                // Deduplicate: same customer+change can have both System and Support — show only one (prefer Support)
                const grouped = new Map<string, LoyaltyTierHistoryEntry>();
                for (const h of withActualChange) {
                  const timeSlot = Math.floor(new Date(h.changed_at).getTime() / 5000);
                  const key = `${h.profile_customer_id}|${h.old_tier ?? ""}|${h.new_tier}|${timeSlot}`;
                  const existing = grouped.get(key);
                  if (!existing || (h.change_type === "manual" && existing.change_type !== "manual")) {
                    grouped.set(key, h);
                  }
                }
                let actualChanges = Array.from(grouped.values());
                // When Support Adjust Tier: hide conflicting System entries (same customer, same time window)
                // e.g. System Gold→Silver + Support Silver→Gold → show only Support
                const supportKeys = new Set(
                  actualChanges
                    .filter((h) => h.change_type === "manual")
                    .map((h) => {
                      const ts = new Date(h.changed_at).getTime();
                      return `${h.profile_customer_id}|${Math.floor(ts / 10000)}`;
                    })
                );
                actualChanges = actualChanges.filter((h) => {
                  if (h.change_type === "manual") return true;
                  const ts = new Date(h.changed_at).getTime();
                  const slotKey = `${h.profile_customer_id}|${Math.floor(ts / 10000)}`;
                  return !supportKeys.has(slotKey);
                });
                actualChanges.sort(
                  (a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime()
                );
                const HISTORY_PAGE_SIZE = 6;
                const totalPages = Math.ceil(actualChanges.length / HISTORY_PAGE_SIZE);
                const paginatedChanges = actualChanges.slice(loyaltyHistoryPage * HISTORY_PAGE_SIZE, (loyaltyHistoryPage + 1) * HISTORY_PAGE_SIZE);

                if (actualChanges.length === 0) {
                  return <div className="py-16 text-center text-muted-foreground">No tier changes found</div>;
                }
                return (
                  <>
                  <Table className="table-fixed w-full border-collapse">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b border-slate-100 h-12">
                        <TableHead className="w-[160px] bg-transparent">Date</TableHead>
                        <TableHead className="w-[220px] bg-transparent">Customer</TableHead>
                        <TableHead className="w-[120px] bg-transparent">Previous</TableHead>
                        <TableHead className="w-[160px] bg-transparent">New Tier</TableHead>
                        <TableHead className="w-[100px] bg-transparent">Origin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedChanges.map((h: LoyaltyTierHistoryEntry) => {
                        const dateToFormat = h.changed_at || h.created_at;
                        const customer = h.customer;
                        const customerName = customer ? `${customer.first_name ?? ""} ${customer.last_name ?? ""}`.trim() || "—" : h.profile_customer_id.slice(0, 8);
                        const customerEmail = customer?.email;
                        const displayOldTier = displayOld(h.old_tier);
                        const oldPriority = getTierPriority(displayOldTier, tierRules);
                        const newPriority = getTierPriority(h.new_tier, tierRules);
                        const isRise = newPriority > oldPriority;
                        const isDrop = newPriority < oldPriority;
                        const tierBadgeClass = (tier: string) => getTierBadgeClass(tier, safeTierColors);
                        return (
                          <TableRow key={h.id} className="border-b border-slate-50 hover:bg-slate-50/50 h-[82px]">
                            <TableCell className="text-sm text-slate-500 py-4 tabular-nums">
                              {dateToFormat ? format(new Date(dateToFormat), "d MMM yyyy HH:mm", { locale: safeLocale }) : "—"}
                            </TableCell>
                            <TableCell className="py-4 truncate" title={customerName}>
                              <div className="font-medium text-sm truncate">{customerName}</div>
                              {customerEmail && <div className="text-xs text-muted-foreground truncate">{customerEmail}</div>}
                            </TableCell>
                            <TableCell className="py-4">
                              <Badge variant="secondary" className={tierBadgeClass(displayOldTier)}>
                                {displayOldTier}
                              </Badge>
                            </TableCell>
                            <TableCell className="py-4">
                              <div className="flex items-center gap-2">
                                {isRise && <TrendingUp className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
                                {isDrop && <TrendingDown className="h-4 w-4 text-red-500 flex-shrink-0" />}
                                <Badge variant="secondary" className={tierBadgeClass(h.new_tier)}>
                                  {h.new_tier}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell className="py-4">
                              <Badge variant="outline" className={cn(
                                "rounded-full text-xs font-medium",
                                h.change_type === "manual" ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-600"
                              )}>
                                {h.change_type === "manual" ? "Support" : "System"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* Pagination Controls */}
                  {actualChanges.length > 0 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                      <p className="text-sm text-slate-500">
                        Showing {(loyaltyHistoryPage * HISTORY_PAGE_SIZE) + 1} - {Math.min((loyaltyHistoryPage * HISTORY_PAGE_SIZE) + HISTORY_PAGE_SIZE, actualChanges.length)}
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLoyaltyHistoryPage(p => Math.max(0, p - 1))}
                          disabled={loyaltyHistoryPage === 0}
                          className="h-8 w-8 p-0"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-medium px-2">
                          Page {loyaltyHistoryPage + 1}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setLoyaltyHistoryPage(p => p + 1)}
                          disabled={loyaltyHistoryPage >= totalPages - 1}
                          className="h-8 w-8 p-0"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                  </>
                );
              })()}
            </div>

          </TabsContent>

          <TabsContent value="transactions" className="m-0">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <ArrowUpDown className="h-4 w-4 text-blue-600" /> Points Transactions
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">Full history of points earned and used</p>
            </div>
            <div className="px-6 pb-6">
              {txLoading ? (
                <div className="space-y-2 py-8"><Skeleton className="h-12 w-full" /></div>
              ) : txError ? (
                <div className="py-16 text-center text-destructive">Error loading transactions</div>
              ) : pointsTransactions.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">No transactions found</div>
              ) : (
                <>
                  <Table className="table-fixed w-full">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent border-b border-slate-100">
                        <TableHead className="bg-transparent w-[180px]">Date</TableHead>
                        <TableHead className="bg-transparent w-[220px]">Customer</TableHead>
                        <TableHead className="text-center bg-transparent w-[80px]">Type</TableHead>
                        <TableHead className="text-center bg-transparent w-[120px]">Amount</TableHead>
                        <TableHead className="text-center bg-transparent w-[150px]">Balance After</TableHead>
                        <TableHead className="bg-transparent">Description</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pointsTransactions.slice(0, ADMIN_PAGE_SIZE).map((tx: { id: string; created_at: string; user_id: string; transaction_type: string; points_amount?: number; balance_after?: number; description?: string; customer?: { full_name?: string; email?: string } }) => {
                        return (
                          <TableRow key={tx.id} className="border-b border-slate-50">
                            <TableCell className="text-sm py-4 w-[180px]">
                              {format(new Date(tx.created_at), "d MMM yyyy HH:mm", { locale: safeLocale })}
                            </TableCell>
                            <TableCell className="font-medium py-4 w-[220px] truncate">
                              <div>{tx.customer?.full_name ?? tx.user_id.slice(0, 8)}</div>
                              {tx.customer?.email && <div className="text-xs text-muted-foreground font-normal">{tx.customer.email}</div>}
                            </TableCell>
                            <TableCell className="text-center py-4 w-[80px]">
                              <Badge variant="outline" className="capitalize rounded-full text-xs font-medium border-slate-200 bg-slate-50">
                                {tx.transaction_type}
                              </Badge>
                            </TableCell>
                            <TableCell className={cn("text-center font-medium py-4 w-[120px]", getTransactionTypeColor(tx.transaction_type))}>
                              {(() => {
                                const amt = tx.points_amount ?? 0;
                                const isDebit = tx.transaction_type === "spend" || tx.transaction_type === "adjustment" || tx.transaction_type === "expire";
                                const displayAmt = isDebit ? -Math.abs(amt) : Math.abs(amt);
                                return (displayAmt >= 0 ? "+" : "") + displayAmt.toLocaleString();
                              })()}
                            </TableCell>
                            <TableCell className="text-center font-semibold py-4 w-[150px]">{(tx.balance_after ?? 0).toLocaleString()}</TableCell>
                            <TableCell className="py-4 text-slate-600 truncate pl-4">{tx.description ?? "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>

                  {/* Pagination */}
                  <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                    <p className="text-sm text-slate-500">
                      Showing {pointsTransactions.length > 0 ? (transactionsPage * ADMIN_PAGE_SIZE) + 1 : 0} - {Math.min((transactionsPage + 1) * ADMIN_PAGE_SIZE, (transactionsPage * ADMIN_PAGE_SIZE) + pointsTransactions.length)}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setTransactionsPage(Math.max(0, transactionsPage - 1))}
                        disabled={transactionsPage === 0}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium px-2">Page {transactionsPage + 1}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setTransactionsPage(transactionsPage + 1)}
                        disabled={pointsTransactions.length <= ADMIN_PAGE_SIZE}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </TabsContent>

          <TabsContent value="alerts" className="m-0">
            <div className="px-6 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-800">Suspicious activity (Loyalty)</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Auto-detected: sudden large point gains (≥500 pts), or rapid earns (3+ per hour)
              </p>
            </div>

            <div className="px-6 py-3 bg-slate-50/50 border-b border-slate-100 flex items-center justify-end gap-3">
              <Select value={alertTypeFilter} onValueChange={(v) => { setAlertTypeFilter(v); setActivitiesPage(0); }}>
                <SelectTrigger className="h-9 w-[160px] bg-white border-slate-200 text-xs shadow-sm hover:border-blue-400 transition-colors">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="large_single_earn">Large single earn</SelectItem>
                  <SelectItem value="rapid_points_spike">Rapid points spike</SelectItem>
                </SelectContent>
              </Select>

              <Select value={alertSeverityFilter} onValueChange={(v) => { setAlertSeverityFilter(v); setActivitiesPage(0); }}>
                <SelectTrigger className="h-9 w-[130px] bg-white border-slate-200 text-xs shadow-sm hover:border-blue-400 transition-colors">
                  <SelectValue placeholder="All severities" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All severities</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                </SelectContent>
              </Select>

              <Select value={alertStatusFilter} onValueChange={(v) => { setAlertStatusFilter(v); setActivitiesPage(0); }}>
                <SelectTrigger className="h-9 w-[120px] bg-white border-slate-200 text-xs shadow-sm hover:border-blue-400 transition-colors">
                  <SelectValue placeholder="All status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="px-6 pb-6 min-h-[520px]">
              {alertsLoading ? (
                <div className="space-y-2 py-8"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
              ) : suspiciousActivities.length === 0 ? (
                <div className="py-16 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50 mt-4">
                  <p className="text-slate-600 font-medium">{isFiltered ? "No alerts match your search filters" : "No suspicious activity detected yet"}</p>
                  <p className="text-sm text-slate-400 mt-1 max-w-sm mx-auto">
                    {isFiltered 
                      ? "Try adjusting your filters or resetting them to see more results." 
                      : "The system automatically monitors for sudden large point gains or rapid earn patterns."}
                  </p>
                  {isFiltered && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-5 h-8 text-xs"
                      onClick={() => {
                        setAlertTypeFilter("all");
                        setAlertSeverityFilter("all");
                        setAlertStatusFilter("all");
                        setActivitiesPage(0);
                      }}
                    >
                      Clear all filters
                    </Button>
                  )}
                </div>
              ) : (
                <Table className="table-fixed w-full border-collapse">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b border-slate-100 h-12">
                      <TableHead className="w-[160px] bg-transparent">Date</TableHead>
                      <TableHead className="w-[220px] bg-transparent">Customer</TableHead>
                      <TableHead className="w-[160px] text-center bg-transparent">Type</TableHead>
                      <TableHead className="w-[110px] text-center bg-transparent">Severity</TableHead>
                      <TableHead className="bg-transparent">Description</TableHead>
                      <TableHead className="w-[100px] text-center bg-transparent">Status</TableHead>
                      <TableHead className="w-[60px] text-right bg-transparent"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {suspiciousActivities.map((a: { id: string; created_at: string; activity_type: string; severity: string; description: string | null; is_resolved: boolean; customer?: { full_name?: string | null; email?: string | null } | null }) => (
                      <TableRow key={a.id} className="border-b border-slate-50 hover:bg-slate-50/50 h-[82px]">
                        <TableCell className="text-sm text-slate-500 py-4 tabular-nums">
                          {format(new Date(a.created_at), "d MMM yyyy HH:mm", { locale: safeLocale })}
                        </TableCell>
                        <TableCell className="py-4 truncate" title={a.customer?.full_name}>
                          <div className="font-medium text-sm truncate">{a.customer?.full_name ?? "—"}</div>
                          {a.customer?.email && <div className="text-xs text-muted-foreground truncate">{a.customer.email}</div>}
                        </TableCell>
                        <TableCell className="py-4 text-center">
                          <Badge variant="outline" className="rounded-full text-xs font-medium border-slate-200 bg-slate-50">
                            {a.activity_type === "large_single_earn" ? "Large single earn" : a.activity_type === "rapid_points_spike" ? "Rapid points spike" : a.activity_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 text-center">
                          <Badge className={cn("rounded-full text-xs font-medium border-none", getSeverityColor(a.severity))}>
                            {a.severity}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-4 text-slate-600 text-sm truncate" title={a.description ?? ""}>{a.description ?? "—"}</TableCell>
                        <TableCell className="py-4 text-center">
                          {a.is_resolved ? (
                            <Badge variant="secondary" className="rounded-full bg-slate-100 text-slate-600">Resolved</Badge>
                          ) : (
                            <Badge variant="destructive" className="rounded-full bg-amber-100 text-amber-800 border-amber-200">Pending</Badge>
                          )}
                        </TableCell>
                        <TableCell className="py-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 text-slate-400 hover:text-slate-600"
                                aria-label="Actions"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem 
                                disabled={a.is_resolved}
                                onClick={() => resolveActivity.mutate({ activityId: a.id })}
                                className="gap-2 cursor-pointer"
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                                <span>Mark as Resolved</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}

              {/* Pagination Controls */}
              {suspiciousActivities.length > 0 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t border-slate-100">
                  <p className="text-sm text-slate-500">
                    Showing {(activitiesPage * ALERTS_PAGE_SIZE) + 1} - {(activitiesPage * ALERTS_PAGE_SIZE) + suspiciousActivities.length}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActivitiesPage(p => Math.max(0, p - 1))}
                      disabled={activitiesPage === 0}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium px-2">
                      Page {activitiesPage + 1}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setActivitiesPage(p => p + 1)}
                      disabled={suspiciousActivities.length < ALERTS_PAGE_SIZE}
                      className="h-8 w-8 p-0"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}