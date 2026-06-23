import { useState } from "react";
import {
    useDevWorkspaces,
    useDevWorkspaceStats,
    useDevWorkspaceMembers,
    useDevWorkspaceAdAccounts,
    useToggleAdAccount,
    useUpdateWorkspaceStatus,
    type Team,
} from "@/hooks/useDevWorkspaces";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Pagination,
    PaginationContent,
    PaginationItem,
    PaginationNext,
    PaginationPrevious,
} from "@/components/ui/pagination";
import {
    Building2, Users, MoreHorizontal, Search, Ban, CheckCircle,
    Globe, Link2, RefreshCw, CreditCard, LayoutGrid, ShieldOff, TrendingUp,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function DevWorkspaces() {
    const { toast } = useToast();
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedWorkspace, setSelectedWorkspace] = useState<Team | null>(null);
    const [viewMode, setViewMode] = useState<"members" | "api" | null>(null);
    const [currentPage, setCurrentPage] = useState(1);
    const ITEMS_PER_PAGE = 8;

    const { data: workspaces, isLoading, refetch } = useDevWorkspaces();
    const updateStatusMutation = useUpdateWorkspaceStatus();

    const { data: rawStats } = useDevWorkspaceStats();
    const workspaceStats = rawStats
        ? Object.fromEntries(
            Object.entries(rawStats).map(([id, s]) => [id, { members: s.memberCount, adAccounts: s.adAccountCount }])
        ) : undefined;

    const { data: workspaceMembers, isLoading: loadingMembers } = useDevWorkspaceMembers(
        selectedWorkspace?.id ?? null, viewMode === "members"
    );
    const { data: workspaceAdAccounts, isLoading: loadingAdAccounts } = useDevWorkspaceAdAccounts(
        selectedWorkspace?.id ?? null, viewMode === "api"
    );
    const toggleAdAccountMutation = useToggleAdAccount();

    const filteredWorkspaces = workspaces?.filter((ws) =>
        ws.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ws.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ws.business_types?.name?.toLowerCase().includes(searchQuery.toLowerCase())
    ) || [];

    const totalPages = Math.ceil(filteredWorkspaces.length / ITEMS_PER_PAGE);
    const paginatedWorkspaces = filteredWorkspaces.slice(
        (currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE
    );

    const handleSearchChange = (v: string) => { setSearchQuery(v); setCurrentPage(1); };
    const handleSuspendToggle = async (workspace: Team) => {
        try {
            await updateStatusMutation.mutateAsync({
                id: workspace.id,
                status: workspace.status === 'suspended' ? 'active' : 'suspended'
            });
        } catch { }
    };
    const handleToggleAdAccount = async (accountId: string, current: boolean | null) => {
        await toggleAdAccountMutation.mutateAsync({ id: accountId, isActive: !current });
        refetch();
    };
    const getRoleBadgeVariant = (role: string) => {
        if (role === "owner") return "default";
        if (role === "admin") return "secondary";
        return "outline";
    };

    const totalMembers = Object.values(workspaceStats || {}).reduce((s, v) => s + v.members, 0);
    const activeCount = workspaces?.filter(w => w.status === 'active').length || 0;
    const suspendedCount = workspaces?.filter(w => w.status === 'suspended').length || 0;

    const kpiCards = [
        { label: "Total Workspaces", value: workspaces?.length || 0, icon: LayoutGrid, color: "#3b82f6", bg: "#eff6ff", border: "#bfdbfe" },
        { label: "Active", value: activeCount, icon: TrendingUp, color: "#10b981", bg: "#ecfdf5", border: "#a7f3d0" },
        { label: "Suspended", value: suspendedCount, icon: ShieldOff, color: "#ef4444", bg: "#fef2f2", border: "#fecaca" },
        { label: "Total Members", value: totalMembers, icon: Users, color: "#06b6d4", bg: "#ecfeff", border: "#a5f3fc" },
    ];
    const NUMBER_STYLE: React.CSSProperties = {
        color: "#0a0a0a",
        fontSize: "2rem",
        fontWeight: 800,
        fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
        fontVariantNumeric: "tabular-nums",
        letterSpacing: "-0.02em",
        lineHeight: 1,
        marginTop: "6px",
    };

    return (
        <div className="min-h-full" style={{ background: "#f8fafc" }}>
            <div className="px-6 py-6 space-y-5">

                {/* ── Header ── */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight" style={{ color: "#0f172a" }}>
                            Workspaces Management
                        </h1>
                        <p className="text-sm mt-0.5" style={{ color: "#64748b" }}>
                            View and manage all workspaces across the platform
                        </p>
                    </div>
                    <button
                        onClick={() => refetch()}
                        className="group flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm"
                        style={{
                            background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                            color: "#ffffff",
                            boxShadow: "0 4px 14px rgba(59,130,246,0.30)",
                            border: "none",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = "0.9")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                    >
                        <RefreshCw className="h-4 w-4 group-hover:rotate-180 transition-transform duration-500" />
                        Refresh
                    </button>
                </div>

                {/* ── KPI Cards ── */}
                <div className="grid grid-cols-4 gap-4">
                    {kpiCards.map((card) => (
                        <div key={card.label}
                            className="rounded-2xl p-5 flex items-center gap-4 transition-transform hover:-translate-y-0.5"
                            style={{
                                background: "#ffffff",
                                border: `1.5px solid ${card.border}`,
                                boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
                            }}>
                            <div className="h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0"
                                style={{ background: card.bg }}>
                                <card.icon className="h-5 w-5" style={{ color: card.color }} />
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#94a3b8" }}>
                                    {card.label}
                                </p>
                                <p style={NUMBER_STYLE}>
                                    {card.value}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── Table Card ── */}
                <div className="rounded-2xl overflow-hidden"
                    style={{ background: "#ffffff", border: "1.5px solid #e2e8f0", boxShadow: "0 4px 20px rgba(0,0,0,0.05)" }}>

                    {/* Search */}
                    <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <div className="relative">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4" style={{ color: "#94a3b8" }} />
                            <input
                                type="text"
                                placeholder="Search workspaces by name, description, or business type..."
                                value={searchQuery}
                                onChange={(e) => handleSearchChange(e.target.value)}
                                className="w-full h-11 pl-11 pr-4 rounded-xl text-sm outline-none transition-all"
                                style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", color: "#0f172a" }}
                                onFocus={e => (e.target.style.borderColor = "#3b82f6")}
                                onBlur={e => (e.target.style.borderColor = "#e2e8f0")}
                            />
                        </div>
                    </div>

                    {/* Table content */}
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                            <RefreshCw className="h-7 w-7 animate-spin text-blue-400" />
                            <span className="text-sm">Loading workspaces...</span>
                        </div>
                    ) : (
                        <table className="w-full text-sm">
                            <thead>
                                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #f1f5f9" }}>
                                    {["Workspace", "Business Type", "Industry", "Members", "Ad Accounts", "Status", "Created", "Actions"].map((h, i) => (
                                        <th key={h}
                                            className={`py-3 text-xs font-bold uppercase tracking-wider ${i >= 3 && i <= 4 ? "text-center" : i === 7 ? "text-right pr-5" : "text-left"} ${i === 0 ? "pl-5" : "px-3"}`}
                                            style={{ color: "#94a3b8" }}>
                                            {h}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {paginatedWorkspaces.map((workspace, idx) => {
                                    const stats = workspaceStats?.[workspace.id] || { members: 0, adAccounts: 0 };
                                    const isSuspended = workspace.status === 'suspended';
                                    const rowBg = idx % 2 === 0 ? "#ffffff" : "#fafbff";

                                    return (
                                        <tr key={workspace.id}
                                            style={{ background: rowBg, borderBottom: "1px solid #f1f5f9", transition: "background 0.15s" }}
                                            onMouseEnter={e => (e.currentTarget.style.background = "#f0f9ff")}
                                            onMouseLeave={e => (e.currentTarget.style.background = rowBg)}
                                        >
                                            <td className="pl-5 pr-3 py-3.5">
                                                <div className="flex items-center gap-3">
                                                    {workspace.logo_url ? (
                                                        <img src={workspace.logo_url} alt={workspace.name} className="h-10 w-10 rounded-xl object-cover flex-shrink-0 shadow-sm" />
                                                    ) : (
                                                        <div className="h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0"
                                                            style={{
                                                                background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
                                                                boxShadow: "0 3px 10px rgba(59,130,246,0.25)",
                                                            }}>
                                                            <Building2 className="h-5 w-5 text-white" />
                                                        </div>
                                                    )}
                                                    <div>
                                                        <div className="font-semibold" style={{ color: "#0f172a" }}>{workspace.name}</div>
                                                        {workspace.description && (
                                                            <div className="text-xs line-clamp-1 max-w-[180px]" style={{ color: "#94a3b8" }}>
                                                                {workspace.description}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>

                                            <td className="px-3 py-3.5">
                                                <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-semibold"
                                                    style={{ background: "#eff6ff", color: "#3b82f6", border: "1px solid #bfdbfe" }}>
                                                    {workspace.business_types?.name || "Uncategorized"}
                                                </span>
                                            </td>

                                            <td className="px-3 py-3.5 text-sm" style={{ color: "#94a3b8" }}>
                                                {workspace.industries?.name || "—"}
                                            </td>

                                            <td className="px-3 py-3.5 text-center">
                                                <div className="flex items-center justify-center gap-1.5">
                                                    <Users className="h-4 w-4 text-blue-400" />
                                                    <span className="font-semibold" style={{ color: "#334155" }}>{stats.members}</span>
                                                </div>
                                            </td>

                                            <td className="px-3 py-3.5 text-center">
                                                <div className="flex items-center justify-center gap-1.5">
                                                    <Link2 className="h-4 w-4 text-cyan-400" />
                                                    <span className="font-semibold" style={{ color: "#334155" }}>{stats.adAccounts}</span>
                                                </div>
                                            </td>

                                            <td className="px-3 py-3.5">
                                                {isSuspended ? (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                                                        style={{ background: "#fef2f2", color: "#ef4444", border: "1px solid #fecaca" }}>
                                                        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                                                        Suspended
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                                                        style={{ background: "#ecfdf5", color: "#10b981", border: "1px solid #a7f3d0" }}>
                                                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                        Active
                                                    </span>
                                                )}
                                            </td>

                                            <td className="px-3 py-3.5 text-sm" style={{ color: "#94a3b8" }}>
                                                {format(new Date(workspace.created_at), "MMM d, yyyy")}
                                            </td>

                                            <td className="pr-5 pl-3 py-3.5 text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <button className="h-8 w-8 rounded-lg flex items-center justify-center transition-colors ml-auto"
                                                            style={{ border: "1px solid #e2e8f0" }}
                                                            onMouseEnter={e => (e.currentTarget.style.background = "#eff6ff")}
                                                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                                                            <MoreHorizontal className="h-4 w-4 text-slate-400" />
                                                        </button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end" className="w-48">
                                                        <DropdownMenuItem onClick={() => { setSelectedWorkspace(workspace); setViewMode("members"); }}>
                                                            <Users className="h-4 w-4 mr-2 text-blue-500" />View Members
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => { setSelectedWorkspace(workspace); setViewMode("api"); }}>
                                                            <Link2 className="h-4 w-4 mr-2 text-cyan-500" />Manage Workspaces
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            className={isSuspended ? "text-emerald-600" : "text-red-500"}
                                                            onClick={() => handleSuspendToggle(workspace)}>
                                                            {isSuspended
                                                                ? <><CheckCircle className="h-4 w-4 mr-2" />Activate Workspace</>
                                                                : <><Ban className="h-4 w-4 mr-2" />Suspend Workspace</>}
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filteredWorkspaces.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="text-center py-16">
                                            <div className="flex flex-col items-center gap-3 text-slate-400">
                                                <div className="h-14 w-14 rounded-2xl flex items-center justify-center bg-slate-50 border border-slate-200">
                                                    <Search className="h-7 w-7 text-slate-300" />
                                                </div>
                                                <p className="font-semibold text-sm text-slate-500">No workspaces found</p>
                                                <p className="text-xs">Try adjusting your search query</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: "1px solid #f1f5f9" }}>
                            <p className="text-sm text-slate-400">
                                Showing{" "}
                                <span className="font-semibold text-slate-600">
                                    {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredWorkspaces.length)}
                                </span>{" "}
                                of <span className="font-semibold text-slate-600">{filteredWorkspaces.length}</span> workspaces
                            </p>
                            <Pagination>
                                <PaginationContent>
                                    <PaginationItem>
                                        <PaginationPrevious onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            className={currentPage === 1 ? "pointer-events-none opacity-40" : "cursor-pointer hover:text-blue-600"} />
                                    </PaginationItem>
                                    <PaginationItem>
                                        <span className="rounded-full px-4 py-1.5 text-xs font-bold text-white"
                                            style={{ background: "linear-gradient(135deg, #3b82f6, #06b6d4)" }}>
                                            {currentPage} / {totalPages}
                                        </span>
                                    </PaginationItem>
                                    <PaginationItem>
                                        <PaginationNext onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            className={currentPage === totalPages ? "pointer-events-none opacity-40" : "cursor-pointer hover:text-blue-600"} />
                                    </PaginationItem>
                                </PaginationContent>
                            </Pagination>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Detail Dialog ── */}
            <Dialog open={!!selectedWorkspace && !!viewMode} onOpenChange={(open) => { if (!open) { setSelectedWorkspace(null); setViewMode(null); } }}>
                <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-3">
                            {selectedWorkspace?.logo_url ? (
                                <img src={selectedWorkspace.logo_url} alt={selectedWorkspace.name} className="h-9 w-9 rounded-xl object-cover shadow-sm" />
                            ) : (
                                <div className="h-9 w-9 rounded-xl flex items-center justify-center"
                                    style={{ background: "linear-gradient(135deg, #3b82f6, #06b6d4)", boxShadow: "0 4px 12px rgba(59,130,246,0.30)" }}>
                                    <Building2 className="h-5 w-5 text-white" />
                                </div>
                            )}
                            <span className="text-slate-800">{selectedWorkspace?.name}</span>
                        </DialogTitle>
                        <DialogDescription className="text-slate-400">
                            {selectedWorkspace?.description || "No description available"}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 rounded-xl mb-4 bg-slate-50 border border-slate-100">
                        {selectedWorkspace?.business_types?.name && (
                            <div className="space-y-1">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Business Type</div>
                                <div className="font-semibold text-sm text-slate-700">{selectedWorkspace.business_types.name}</div>
                            </div>
                        )}
                        {selectedWorkspace?.industries?.name && (
                            <div className="space-y-1">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Industry</div>
                                <div className="font-semibold text-sm text-slate-700">{selectedWorkspace.industries.name}</div>
                            </div>
                        )}
                        {selectedWorkspace?.workspace_url && (
                            <div className="space-y-1">
                                <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Website</div>
                                <a href={selectedWorkspace.workspace_url} target="_blank" rel="noopener noreferrer"
                                    className="font-semibold text-sm flex items-center gap-1 text-blue-500 hover:underline">
                                    <Globe className="h-3 w-3" /> Visit
                                </a>
                            </div>
                        )}
                        <div className="space-y-1">
                            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</div>
                            <div className="font-semibold text-sm capitalize text-slate-700">{selectedWorkspace?.status || "Active"}</div>
                        </div>
                    </div>

                    <Tabs value={viewMode || "members"} onValueChange={(v) => setViewMode(v as "members" | "api")}>
                        <TabsList className="bg-slate-100">
                            <TabsTrigger value="members" className="data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-sm">
                                <Users className="h-4 w-4 mr-2" /> Members ({workspaceMembers?.length || 0})
                            </TabsTrigger>
                            <TabsTrigger value="api" className="data-[state=active]:bg-white data-[state=active]:text-cyan-600 data-[state=active]:shadow-sm">
                                <Link2 className="h-4 w-4 mr-2" /> API Connections ({workspaceAdAccounts?.length || 0})
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value="members" className="mt-4">
                            {loadingMembers ? (
                                <div className="text-center py-8 text-slate-400">Loading members...</div>
                            ) : (
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-100">
                                            {["Member", "Role", "Status", "Joined"].map(h => (
                                                <th key={h} className="text-left py-2.5 px-3 text-xs font-bold uppercase tracking-wide text-slate-400">{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {workspaceMembers?.map((member) => (
                                            <tr key={member.id} className="border-b border-slate-50 hover:bg-blue-50/30 transition-colors">
                                                <td className="py-3 px-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className="h-8 w-8 rounded-full flex items-center justify-center"
                                                            style={{ background: "linear-gradient(135deg, #3b82f6, #06b6d4)" }}>
                                                            <Users className="h-4 w-4 text-white" />
                                                        </div>
                                                        <div>
                                                            <div className="font-medium text-slate-700">{member.profile?.full_name || "Unknown User"}</div>
                                                            <div className="text-xs text-slate-400">{member.profile?.email || member.user_id}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-3"><Badge variant={getRoleBadgeVariant(member.role)}>{member.role}</Badge></td>
                                                <td className="py-3 px-3"><Badge variant={member.status === "active" ? "default" : "secondary"}>{member.status}</Badge></td>
                                                <td className="py-3 px-3 text-sm text-slate-400">{format(new Date(member.joined_at), "MMM d, yyyy")}</td>
                                            </tr>
                                        ))}
                                        {workspaceMembers?.length === 0 && (
                                            <tr><td colSpan={4} className="text-center py-8 text-slate-400">No members found</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </TabsContent>

                        <TabsContent value="api" className="mt-4">
                            {loadingAdAccounts ? (
                                <div className="text-center py-8 text-slate-400">Loading API connections...</div>
                            ) : (
                                <div className="space-y-3">
                                    {workspaceAdAccounts?.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
                                            <div className="h-12 w-12 rounded-xl flex items-center justify-center bg-slate-50 border border-slate-200">
                                                <Link2 className="h-6 w-6 text-slate-300" />
                                            </div>
                                            <p className="text-sm">No API connections configured</p>
                                        </div>
                                    ) : (
                                        workspaceAdAccounts?.map((account) => (
                                            <div key={account.id} className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 hover:bg-blue-50/40 transition-colors">
                                                <div className="flex items-center gap-3">
                                                    <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-white border border-slate-200 shadow-sm">
                                                        {account.platforms?.icon_url
                                                            ? <img src={account.platforms.icon_url} alt="" className="h-6 w-6" />
                                                            : <CreditCard className="h-5 w-5 text-slate-400" />}
                                                    </div>
                                                    <div>
                                                        <div className="font-medium text-sm text-slate-700">{account.account_name}</div>
                                                        <div className="text-xs text-slate-400">
                                                            {account.platforms?.name || "Unknown Platform"} · ID: {account.platform_account_id || "N/A"}
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {account.is_active ? (
                                                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold"
                                                            style={{ background: "#ecfdf5", color: "#10b981", border: "1px solid #a7f3d0" }}>
                                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />Active
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold text-slate-400 bg-slate-100 border border-slate-200">
                                                            <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />Inactive
                                                        </span>
                                                    )}
                                                    <Button variant="outline" size="sm" className="h-7 text-xs rounded-lg"
                                                        onClick={() => handleToggleAdAccount(account.id, account.is_active)}>
                                                        {account.is_active
                                                            ? <><Ban className="h-3 w-3 mr-1" />Disable</>
                                                            : <><CheckCircle className="h-3 w-3 mr-1" />Enable</>}
                                                    </Button>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>
        </div>
    );
}
