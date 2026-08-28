import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCustomerCoupons } from "@/hooks/useCustomerCoupons";
import {
    Ticket,
    CheckCircle2,
    Clock,
    Percent,
    DollarSign,
    Loader2,
    Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { TH_DATE_LOCALE } from "@/lib/date";

interface MyCouponsModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MyCouponsModal({ open, onOpenChange }: MyCouponsModalProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl w-full p-0 gap-0 overflow-hidden rounded-2xl shadow-2xl bg-background border-border">
                <DialogHeader className="px-7 pt-6 pb-4 border-b border-border/50">
                    <DialogTitle className="font-black text-2xl flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                            <Ticket className="h-5 w-5 text-emerald-600" />
                        </div>
                        My Coupons
                    </DialogTitle>
                </DialogHeader>

                <CouponContent />
            </DialogContent>
        </Dialog>
    );
}

// ─── Coupon Content ───────────────────────────────────────────────────────────
function CouponContent() {
    const { collectedCoupons, isLoadingCoupons } = useCustomerCoupons();

    const copyCode = (code: string) => {
        navigator.clipboard.writeText(code);
        toast.success(`Copied "${code}" to clipboard`);
    };

    if (isLoadingCoupons) {
        return (
            <div className="flex items-center justify-center py-20 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                <span className="text-sm">Loading...</span>
            </div>
        );
    }

    if (collectedCoupons.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-20 px-6 text-center">
                <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-4">
                    <Ticket className="h-8 w-8 text-primary/30" />
                </div>
                <p className="font-bold text-base text-muted-foreground">No coupons collected</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-[220px] leading-relaxed">
                    Collect promotional codes from notifications to see them here.
                </p>
            </div>
        );
    }

    const unused = collectedCoupons.filter((c) => !c.used_at);
    const used = collectedCoupons.filter((c) => !!c.used_at);

    return (
        <div className="max-h-[65vh] overflow-y-auto">
            {/* Summary bar */}
            <div className="px-6 py-3 flex items-center gap-4 bg-muted/30 border-b border-border/50">
                <div className="flex items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="text-muted-foreground">{unused.length} available</span>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    <span className="text-muted-foreground">{used.length} used</span>
                </div>
            </div>

            <div className="px-4 py-3 space-y-3">
                {collectedCoupons.map((coupon) => {
                    const d = coupon.discounts;
                    if (!d) return null;

                    const isExpired = d.end_date && new Date(d.end_date) < new Date();
                    const isUsed = !!coupon.used_at;
                    const isAvailable = !isUsed && !isExpired;

                    let statusBadge;
                    if (isUsed) {
                        statusBadge = (
                            <Badge className="text-[10px] h-5 px-2 gap-1 bg-slate-500/10 text-slate-500 border-slate-500/20">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Used
                            </Badge>
                        );
                    } else if (isExpired) {
                        statusBadge = (
                            <Badge className="text-[10px] h-5 px-2 bg-destructive/10 text-destructive border-destructive/20">
                                Expired
                            </Badge>
                        );
                    } else {
                        statusBadge = (
                            <Badge className="text-[10px] h-5 px-2 gap-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Ready
                            </Badge>
                        );
                    }

                    return (
                        <div
                            key={coupon.id}
                            className={cn(
                                "rounded-2xl border p-4 transition-all",
                                isUsed || isExpired
                                    ? "opacity-55 bg-muted/30"
                                    : "bg-card hover:border-primary/30 hover:shadow-sm"
                            )}
                        >
                            {/* Top row */}
                            <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <Badge
                                        variant="outline"
                                        className="text-[10px] h-5 px-2 gap-1 font-bold bg-background"
                                    >
                                        {d.discount_type === "percent" ? (
                                            <>
                                                <Percent className="h-2.5 w-2.5" />
                                                {d.discount_value}% off
                                            </>
                                        ) : (
                                            <>
                                                <DollarSign className="h-2.5 w-2.5" />
                                                ฿{d.discount_value} off
                                            </>
                                        )}
                                    </Badge>
                                    {statusBadge}
                                </div>
                            </div>

                            <h4 className="font-bold text-sm">{d.name || "Special Offer"}</h4>
                            {d.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                    {d.description}
                                </p>
                            )}

                            {/* Meta */}
                            <div className="flex flex-wrap items-center gap-3 mt-2 text-[10px] text-muted-foreground font-medium">
                                {d.end_date && (
                                    <div className="flex items-center gap-1">
                                        <Clock className="h-2.5 w-2.5" />
                                        {isExpired
                                            ? `Expired ${new Date(d.end_date).toLocaleDateString()}`
                                            : `Valid until ${new Date(d.end_date).toLocaleDateString()}`}
                                    </div>
                                )}
                                {d.min_order_value > 0 && (
                                    <div>Min order ฿{d.min_order_value}</div>
                                )}
                                {isUsed && coupon.used_at && (
                                    <div className="flex items-center gap-1">
                                        <Package className="h-2.5 w-2.5" />
                                        Used on {new Date(coupon.used_at).toLocaleDateString(TH_DATE_LOCALE)}
                                    </div>
                                )}
                            </div>

                            {/* Code + Copy */}
                            <div className="mt-3 pt-3 border-t border-dashed flex items-center justify-between -mx-4 px-4 pb-0">
                                <span className="font-mono font-black text-primary text-sm tracking-widest bg-background px-3 py-1.5 rounded-lg border">
                                    {d.code}
                                </span>
                                <Button
                                    size="sm"
                                    onClick={() => copyCode(d.code)}
                                    disabled={isUsed || !!isExpired}
                                    className="h-8 text-xs font-bold shrink-0"
                                    variant={isAvailable ? "default" : "secondary"}
                                >
                                    {isUsed ? "Used" : isExpired ? "Expired" : "Copy Code"}
                                </Button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
