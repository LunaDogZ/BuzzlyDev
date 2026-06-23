import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDevErrorLogs, useDevLogStats, ErrorLog } from "@/hooks/useDevSupport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    AlertCircle,
    AlertTriangle,
    Bug,
    Info,
    Search,
    XCircle,
    RefreshCw,
    Eye,
    Clock,
    ChevronLeft,
    ChevronRight,
    Copy,
    Check,
    FileText,
    Code,
    Server,
    Filter
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { cn, getErrorMessage } from "@/lib/utils";

import { logError } from "@/services/errorLogger";
import { useToast } from "@/hooks/use-toast";

export default function DevSupport() {
    const [searchQuery, setSearchQuery] = useState("");
    const [levelFilter, setLevelFilter] = useState<string>("all");
    const [selectedLog, setSelectedLog] = useState<ErrorLog | null>(null);
    const [copied, setCopied] = useState(false);
    const { toast } = useToast();
    const queryClient = useQueryClient();

    const handleSimulateError = async () => {
        try {
            throw new Error("Test error generated manually by Dev");
        } catch (err) {
            try {
                await logError("Manual Test Error Verification", err, {
                    component: "DevSupport",
                    action: "simulate_error",
                    source: "dev_ui",
                    service: "Dev Console"
                });

                toast({
                    title: "Test Error Logged",
                    description: "A test error has been sent to the system. Refreshing list...",
                });

                setTimeout(() => {
                    queryClient.invalidateQueries({ queryKey: ["dev-error-logs"] });
                    queryClient.invalidateQueries({ queryKey: ["dev-error-stats"] });
                    // Force refresh notifications to ensure the bell updates even if realtime is slightly delayed
                    queryClient.invalidateQueries({ queryKey: ["notifications"] });
                    refetch();
                }, 800);
            } catch (logErr) {
                toast({
                    variant: "destructive",
                    title: "Failed to log error",
                    description: getErrorMessage(logErr),
                });
            }
        }
    };

    const copyToClipboard = (text: string, description: string = "Error details copied to clipboard") => {
        navigator.clipboard.writeText(text);
        if (text === JSON.stringify(selectedLog, null, 2)) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
        toast({
            title: "Copied to clipboard",
            description: description,
        });
    };

    const [page, setPage] = useState(1);
    const pageSize = 8;

    const { data, isLoading, isFetching, refetch } = useDevErrorLogs(levelFilter, page, pageSize, searchQuery);
    const errorLogs = data?.logs || [];
    const totalCount = data?.totalCount || 0;
    const totalPages = data?.totalPages || 0;

    useEffect(() => {
        setPage(1);
    }, [levelFilter, searchQuery]);

    const handlePageChange = (newPage: number) => {
        setPage(newPage);
    };




    const getLevelIcon = (level: string) => {
        switch (level.toLowerCase()) {
            case "critical":
                return <XCircle className="h-4 w-4 text-destructive" />;
            case "error":
                return <AlertCircle className="h-4 w-4 text-destructive" />;
            case "warning":
            case "warn":
                return <AlertTriangle className="h-4 w-4 text-amber-500" />;
            case "info":
                return <Info className="h-4 w-4 text-blue-500" />;
            case "debug":
                return <Bug className="h-4 w-4 text-muted-foreground" />;
            default:
                return <FileText className="h-4 w-4 text-muted-foreground" />;
        }
    };

    const getLevelBadge = (level: string) => {
        switch (level.toLowerCase()) {
            case "critical":
                return <Badge className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">Critical</Badge>;
            case "error":
                return <Badge className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">Error</Badge>;
            case "warning":
            case "warn":
                return <Badge className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">Warning</Badge>;
            case "info":
                return <Badge className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">Info</Badge>;
            case "debug":
                return <Badge className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">Debug</Badge>;
            default:
                return <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-xs font-medium border-slate-700 text-slate-400">{level}</Badge>;
        }
    };

    const { data: statsData, isLoading: isLoadingStats } = useDevLogStats();

    const stats = {
        total: statsData?.total || 0,
        critical: statsData?.critical || 0,
        errors: statsData?.error || 0,
        warnings: statsData?.warning || 0,
        info: statsData?.info || 0,
    };

    return (
        <div className="space-y-6 text-slate-200 pb-12">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-white tracking-tight">Support & Error Logs</h1>
                    <p className="text-slate-400 font-medium">
                        Monitor system health and diagnose issues
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="destructive" size="sm" onClick={handleSimulateError} className="bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20">
                        <Bug className="h-4 w-4 mr-2" />
                        Test Error
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => refetch()} className="bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-900 hover:text-white">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card className="bg-slate-900/50 border-slate-800 shadow-lg">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                            Total Logs
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-white leading-tight">{stats.total}</div>
                    </CardContent>
                </Card>
                <Card className="bg-slate-900/50 border-rose-900/40 shadow-lg bg-rose-950/5">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-semibold text-rose-400 uppercase tracking-wider flex items-center gap-2">
                            <XCircle className="h-3 w-3" />
                            Critical
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-rose-500 leading-tight">{stats.critical}</div>
                    </CardContent>
                </Card>
                <Card className="bg-slate-900/50 border-slate-800 shadow-lg">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <AlertCircle className="h-3 w-3" />
                            Errors
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-rose-500 leading-tight">{stats.errors}</div>
                    </CardContent>
                </Card>
                <Card className="bg-slate-900/50 border-slate-800 shadow-lg">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <AlertTriangle className="h-3 w-3" />
                            Warnings
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-amber-400 leading-tight">{stats.warnings}</div>
                    </CardContent>
                </Card>
                <Card className="bg-slate-900/50 border-slate-800 shadow-lg">
                    <CardHeader className="p-4 pb-2">
                        <CardTitle className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                            <Info className="h-3 w-3" />
                            Info
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                        <div className="text-2xl font-bold text-blue-400 leading-tight">{stats.info}</div>
                    </CardContent>
                </Card>
            </div>

            {/* Search & Filter */}
            <Card className="bg-slate-900/50 border-slate-800 shadow-lg">
                <CardHeader className="p-4">
                    <div className="flex flex-col sm:flex-row items-center gap-4">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                            <Input
                                placeholder="Search logs..."
                                value={searchQuery}
                                onChange={(e) => {
                                    setSearchQuery(e.target.value);
                                    setPage(1);
                                }}
                                className="pl-10 bg-black/20 border-slate-800 text-white placeholder-slate-600 focus-visible:ring-slate-800"
                            />
                        </div>
                        <Select value={levelFilter} onValueChange={(val) => {
                            setLevelFilter(val);
                            setPage(1);
                        }}>
                            <SelectTrigger className="w-full sm:w-[180px] bg-black/20 border-slate-800 text-slate-300">
                                <div className="flex items-center">
                                    <Filter className="h-4 w-4 mr-2 text-slate-500" />
                                    <SelectValue placeholder="Filter by level" />
                                </div>
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                                <SelectItem value="all">All Levels</SelectItem>
                                <SelectItem value="critical">Critical Only</SelectItem>
                                <SelectItem value="error">Errors Only</SelectItem>
                                <SelectItem value="warning">Warnings Only</SelectItem>
                                <SelectItem value="info">Info Only</SelectItem>
                                <SelectItem value="debug">Debug Only</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardHeader>
                <CardContent className="p-0 relative bg-slate-900/30">
                    {(!data && isLoading) ? (
                        <div className="text-center py-12 text-slate-500 animate-pulse font-medium">
                            Loading error logs...
                        </div>
                    ) : (
                        <div className={cn("overflow-hidden transition-opacity duration-200", isFetching && "opacity-50")}>
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-900/40 border-b border-slate-800 hover:bg-slate-900/40">
                                        <TableHead className="w-[120px] text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Level</TableHead>
                                        <TableHead className="w-[400px] text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Message</TableHead>
                                        <TableHead className="w-[150px] text-slate-400 font-semibold uppercase text-[10px] tracking-wider">User</TableHead>
                                        <TableHead className="w-[120px] text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Request ID</TableHead>
                                        <TableHead className="w-[150px] text-slate-400 font-semibold uppercase text-[10px] tracking-wider">Time</TableHead>
                                        <TableHead className="text-right w-[80px] text-slate-400 font-semibold uppercase text-[10px] tracking-wider pr-6">Details</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {errorLogs?.map((log) => (
                                        <TableRow key={log.id} className="group cursor-pointer border-b border-slate-800/50 hover:bg-slate-800/20 transition-colors" onClick={() => setSelectedLog(log)}>
                                            <TableCell className="align-middle py-3">
                                                <div className="flex items-center gap-2">
                                                    {getLevelBadge(log.level)}
                                                </div>
                                            </TableCell>
                                            <TableCell className="align-middle py-3 max-w-[400px]">
                                                <div className="font-mono text-xs text-slate-300 line-clamp-2 break-all" title={log.message}>
                                                    {log.message}
                                                </div>
                                            </TableCell>
                                            <TableCell className="align-middle py-3">
                                                {log.user_id ? (
                                                    <div className="flex flex-col gap-0.5">
                                                        <div className="flex items-center gap-1.5" title={log.user_email || "Unknown Email"}>
                                                            <span className="text-sm font-semibold text-white truncate max-w-[130px]">
                                                                {log.user_email?.split('@')[0] || "Unknown"}
                                                            </span>
                                                            {log.user_email && (
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        copyToClipboard(log.user_email!, "User email copied to clipboard");
                                                                    }}
                                                                    className="p-1 rounded-md hover:bg-slate-800 text-slate-500 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
                                                                    title="Copy Email"
                                                                >
                                                                    <Copy className="h-3 w-3" />
                                                                </button>
                                                            )}
                                                        </div>
                                                        <p className="text-[10px] text-slate-500 font-medium">
                                                            {log.user_id.slice(0, 8)}
                                                        </p>
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-500 text-sm italic">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="align-middle py-3">
                                                {log.request_id ? (
                                                    <code className="text-[10px] font-mono text-slate-400 bg-slate-950/50 px-1.5 py-0.5 rounded border border-slate-800/50">
                                                        {log.request_id.slice(0, 8)}
                                                    </code>
                                                ) : (
                                                    <span className="text-slate-500 italic">-</span>
                                                )}
                                            </TableCell>
                                            <TableCell className="align-middle py-3">
                                                <div className="flex flex-col gap-0.5 text-xs">
                                                    <span className="font-bold text-slate-300">
                                                        {log.created_at ? formatDistanceToNow(new Date(log.created_at), { addSuffix: true }) : "-"}
                                                    </span>
                                                    <span className="text-[10px] text-slate-500 font-medium">
                                                        {log.created_at ? format(new Date(log.created_at), "MMM d, HH:mm") : ""}
                                                    </span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right align-middle py-3 pr-6">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-slate-500 hover:text-white hover:bg-slate-800 transition-all opacity-0 group-hover:opacity-100"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {errorLogs?.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                                                <div className="flex flex-col items-center gap-2">
                                                    <Check className="h-8 w-8 text-green-500/50" />
                                                    <p>No error logs found matching your criteria</p>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {/* Pagination Controls */}
                    <div className="flex items-center justify-between p-4 bg-slate-900 border-t border-slate-800">
                        <div className="text-xs text-slate-500 font-medium tracking-tight">
                            Showing <span className="text-slate-300">{errorLogs.length > 0 ? (page - 1) * pageSize + 1 : 0}</span> to <span className="text-slate-300">{Math.min(page * pageSize, totalCount)}</span> of <span className="text-slate-300">{totalCount}</span> entries
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handlePageChange(page - 1)}
                                disabled={page <= 1 || isLoading}
                                className="h-8 bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                            >
                                <ChevronLeft className="h-4 w-4 mr-1" />
                                Prev
                            </Button>
                            <div className="text-xs font-semibold text-slate-400 px-2 min-w-[80px] text-center">
                                Page <span className="text-slate-200">{page}</span> of <span className="text-slate-200">{totalPages}</span>
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handlePageChange(page + 1)}
                                disabled={page >= totalPages || isLoading}
                                className="h-8 bg-slate-950 border-slate-800 text-slate-400 hover:text-white"
                            >
                                Next
                                <ChevronRight className="h-4 w-4 ml-1" />
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Error Detail Dialog */}
            <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
                <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col p-0 gap-0 bg-slate-900 border-slate-800 text-slate-200 shadow-2xl overflow-hidden rounded-xl">
                    <DialogHeader className="p-6 pb-4 border-b border-slate-800 bg-slate-900/50">
                        <div className="flex items-start justify-between">
                            <div className="space-y-1">
                                <DialogTitle className="flex items-center gap-2 text-2xl font-bold text-white tracking-tight">
                                    Error Diagnostics
                                    {selectedLog && getLevelBadge(selectedLog.level)}
                                </DialogTitle>
                                <DialogDescription className="text-slate-400 font-medium">
                                    Logged {selectedLog?.created_at && format(new Date(selectedLog.created_at), "PPP 'at' HH:mm:ss")}
                                </DialogDescription>
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => selectedLog && copyToClipboard(JSON.stringify(selectedLog, null, 2))}
                                className="bg-slate-950 border-slate-800 text-slate-300 hover:bg-slate-800"
                            >
                                {copied ? <Check className="h-4 w-4 mr-2 text-emerald-400" /> : <Copy className="h-4 w-4 mr-2" />}
                                {copied ? "Copied" : "Copy JSON"}
                            </Button>
                        </div>
                    </DialogHeader>

                    {selectedLog && (
                        <div className="flex-1 p-6 overflow-y-auto">
                            <div className="space-y-6">
                                {/* Context Grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5 bg-slate-950/40 rounded-xl border border-slate-800/60 shadow-inner">
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">User Impacted</label>
                                        <div className="flex items-center gap-1.5 group/email">
                                            <div className="text-sm font-bold text-white truncate" title={selectedLog.user_email || "N/A"}>
                                                {selectedLog.user_email || "Anonymous"}
                                            </div>
                                            {selectedLog.user_email && (
                                                <button
                                                    onClick={() => copyToClipboard(selectedLog.user_email!, "User email copied to clipboard")}
                                                    className="p-1 rounded-md hover:bg-slate-800 text-slate-500 hover:text-white transition-colors"
                                                    title="Copy Email"
                                                >
                                                    <Copy className="h-3 w-3" />
                                                </button>
                                            )}
                                        </div>
                                        {selectedLog.user_id && (
                                            <code className="text-[10px] bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded text-slate-400 font-mono">
                                                {selectedLog.user_id.slice(0, 12)}
                                            </code>
                                        )}
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Request Reference</label>
                                        <div>
                                            {selectedLog.request_id ? (
                                                <code className="text-[10px] font-mono bg-slate-900 border border-slate-800 px-1.5 py-0.5 rounded text-slate-300">{selectedLog.request_id.slice(0, 16)}</code>
                                            ) : (
                                                <span className="text-sm text-slate-600 italic">Not available</span>
                                            )}
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Target Service</label>
                                        <div className="text-sm font-bold text-slate-200">
                                            {String(selectedLog.metadata?.service ?? "Backend Core")}
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cluster Node</label>
                                        <div className="text-sm font-bold text-slate-200">
                                            {String(selectedLog.metadata?.env ?? "Production")}
                                        </div>
                                    </div>
                                </div>

                                {/* Message */}
                                <div className="space-y-3">
                                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-slate-500" />
                                        Primary Failure Message
                                    </h3>
                                    <div className="p-5 rounded-xl border border-rose-500/20 bg-rose-500/5 shadow-inner">
                                        <p className="font-mono text-xs font-bold break-all text-rose-400 leading-relaxed">
                                            {selectedLog.message || <span className="text-slate-600 italic">Static empty message from origin</span>}
                                        </p>
                                    </div>
                                </div>

                                {/* Stack Trace */}
                                {selectedLog.stack_trace && (
                                    <div className="space-y-3">
                                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                            <Code className="h-4 w-4 text-slate-500" />
                                            Stack Trace Analysis
                                        </h3>
                                        <div className="p-5 bg-slate-950 text-slate-300 rounded-xl font-mono text-[11px] whitespace-pre-wrap break-all shadow-2xl border border-slate-800 leading-relaxed overflow-x-auto max-h-[400px]">
                                            {selectedLog.stack_trace}
                                        </div>
                                    </div>
                                )}

                                {/* Metadata */}
                                {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                                    <div className="space-y-3 pt-4">
                                        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                            <Server className="h-4 w-4 text-slate-500" />
                                            Augmented Metadata
                                        </h3>
                                        <div className="p-5 bg-slate-900/50 rounded-xl font-mono text-[11px] whitespace-pre-wrap border border-slate-800 shadow-inner text-slate-400">
                                            {JSON.stringify(selectedLog.metadata, null, 2)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
}
