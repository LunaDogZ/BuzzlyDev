import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import { CheckCircle2, Clock, Copy, Search, Ticket, Users, Gift } from "lucide-react";
import { useAllRedeemedCoupons } from "@/hooks/useUserRedeemedCoupons";
import { toast } from "sonner";

export default function RedemptionRequests() {
    const { data: redemptions = [], isLoading } = useAllRedeemedCoupons();
    const [searchTerm, setSearchTerm] = useState("");

    const filtered = redemptions.filter((r) =>
        r.user_email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.reward_item?.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        r.coupon_code?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const unusedCount = redemptions.filter((r) => r.status === "unused").length;
    const usedCount   = redemptions.filter((r) => r.status === "used").length;

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        toast.success(`Copied "${code}"`);
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {/* Header */}
            <div>
                <div className="flex items-center gap-2 text-amber-600 font-bold text-xs uppercase tracking-widest mb-2">
                    <Ticket className="h-4 w-4" />
                    Loyalty Programme
                </div>
                <h1 className="text-4xl font-bold tracking-tight">Redemption Requests</h1>
                <p className="text-muted-foreground mt-2 text-lg">
                    Auto-generated coupon codes from customer loyalty point redemptions
                </p>
            </div>

            {/* Stat Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                    {
                        label: "Total Redeemed",
                        value: redemptions.length,
                        icon: Gift,
                        gradient: "from-violet-600 to-purple-700",
                    },
                    {
                        label: "Codes Unused",
                        value: unusedCount,
                        icon: Clock,
                        gradient: "from-emerald-600 to-teal-700",
                    },
                    {
                        label: "Codes Used",
                        value: usedCount,
                        icon: CheckCircle2,
                        gradient: "from-slate-600 to-slate-700",
                    },
                ].map((s) => (
                    <Card
                        key={s.label}
                        className={`bg-gradient-to-br ${s.gradient} border-none shadow-xl text-white overflow-hidden relative`}
                    >
                        <div className="absolute top-0 right-0 p-4 opacity-10">
                            <s.icon className="h-20 w-20 transform rotate-12 translate-x-6 -translate-y-2" />
                        </div>
                        <CardContent className="p-5 relative z-10">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/20 mb-3">
                                <s.icon className="h-4 w-4" />
                            </div>
                            <p className="text-3xl font-bold">{s.value}</p>
                            <p className="text-sm font-medium mt-0.5 text-white/80">{s.label}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Table */}
            <Card className="glass-panel">
                <CardHeader className="px-6 pt-6 pb-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div>
                            <CardTitle className="text-xl font-bold flex items-center gap-2">
                                <Users className="h-5 w-5 text-amber-600" />
                                All Redemption Records
                            </CardTitle>
                            <CardDescription className="mt-1">
                                Click a code to copy it to your clipboard
                            </CardDescription>
                        </div>
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search customer, reward, code…"
                                className="pl-9 rounded-xl"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="px-6 pb-6">
                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4].map((i) => (
                                <Skeleton key={i} className="h-14 w-full rounded-xl" />
                            ))}
                        </div>
                    ) : (
                        <div className="rounded-xl border overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/50">
                                    <TableRow>
                                        <TableHead>Date</TableHead>
                                        <TableHead>Customer</TableHead>
                                        <TableHead>Reward Redeemed</TableHead>
                                        <TableHead>Coupon Code</TableHead>
                                        <TableHead>Points Used</TableHead>
                                        <TableHead>Status</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {filtered.length === 0 ? (
                                        <TableRow>
                                            <TableCell
                                                colSpan={6}
                                                className="text-center py-16 text-muted-foreground"
                                            >
                                                {searchTerm
                                                    ? "No results match your search."
                                                    : "No redemptions yet — codes will appear here when customers redeem rewards."}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        filtered.map((row) => (
                                            <TableRow key={row.id}>
                                                {/* Date */}
                                                <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                                    {format(new Date(row.redeemed_at), "dd MMM yyyy HH:mm")}
                                                </TableCell>

                                                {/* Customer */}
                                                <TableCell>
                                                    <div className="font-medium text-sm">
                                                        {row.customer_name ?? "—"}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground">
                                                        {row.user_email ?? row.user_id}
                                                    </div>
                                                </TableCell>

                                                {/* Reward */}
                                                <TableCell>
                                                    <div className="font-medium text-sm">
                                                        {row.reward_item?.name ?? "—"}
                                                    </div>
                                                    <div className="text-xs text-muted-foreground capitalize">
                                                        {row.reward_item?.reward_type}
                                                    </div>
                                                </TableCell>

                                                {/* Coupon Code — clickable copy */}
                                                <TableCell>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="font-mono font-black tracking-widest text-primary border-primary/20 bg-primary/5 hover:bg-primary/10 gap-2 h-8 px-3"
                                                        onClick={() => copyCode(row.coupon_code)}
                                                    >
                                                        {row.coupon_code}
                                                        <Copy className="h-3 w-3" />
                                                    </Button>
                                                </TableCell>

                                                {/* Points */}
                                                <TableCell>
                                                    <span className="font-bold text-amber-600">
                                                        {row.reward_item?.points_cost?.toLocaleString() ?? "—"} pts
                                                    </span>
                                                </TableCell>

                                                {/* Status */}
                                                <TableCell>
                                                    {row.status === "used" ? (
                                                        <Badge className="text-[10px] bg-slate-500/10 text-slate-600 border-slate-500/20">
                                                            <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                                                            Used
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                                            <Clock className="h-2.5 w-2.5 mr-1" />
                                                            Unused
                                                        </Badge>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
