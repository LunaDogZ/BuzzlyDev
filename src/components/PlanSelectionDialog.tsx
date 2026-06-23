import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Check, Users, Zap, Crown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlanAccess, PlanType } from "@/hooks/usePlanAccess";
import { useSubscription, SubscriptionPlan, BillingCycle } from "@/hooks/useSubscription";
import { PaymentMethodDialog } from "@/components/subscription/PaymentMethodDialog";
import { toast } from "@/hooks/use-toast";
import { useLoyaltyTier } from "@/hooks/useLoyaltyTier";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/services/errorLogger";

interface PlanSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const planIcons: Record<string, React.ReactNode> = {
  free: <Zap className="h-5 w-5" />,
  pro: <Crown className="h-5 w-5" />,
  team: <Users className="h-5 w-5" />,
};

const planColors: Record<string, { text: string; bg: string; gradient: string }> = {
  free: {
    text: "text-muted-foreground",
    bg: "bg-muted",
    gradient: "from-muted/50 to-muted/20",
  },
  pro: {
    text: "text-primary",
    bg: "bg-primary/20",
    gradient: "from-primary/20 to-primary/5",
  },
  team: {
    text: "text-violet-500",
    bg: "bg-violet-500/20",
    gradient: "from-violet-500/20 to-violet-500/5",
  },
};

export function PlanSelectionDialog({ open, onOpenChange }: PlanSelectionDialogProps) {
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const { currentPlan, updatePlan, refetch: refetchPlanAccess } = usePlanAccess();
  const {
    plans,
    paymentMethods,
    loading,
    getMonthlyEquivalent,
    getSavingsPercent,
    createSubscription,
    refetch: refetchSubscription,
  } = useSubscription();
  const { refetch: refetchLoyalty } = useLoyaltyTier();

  // Reset state when dialog opens; pre-select current plan so users see their status
  useEffect(() => {
    if (open && plans.length > 0) {
      const current = plans.find((p) => p.slug === currentPlan);
      setSelectedPlan(current ?? null);
      setShowPaymentDialog(false);
    }
  }, [open, plans, currentPlan]);

  const handleSelectPlan = (plan: SubscriptionPlan) => {
    setSelectedPlan(plan);
  };

  const handleProceedToPayment = () => {
    if (!selectedPlan) return;

    // If selecting free plan, just update directly
    if (selectedPlan.slug === "free") {
      handleFreePlanSelect();
      return;
    }

    // For paid plans, show payment dialog
    setShowPaymentDialog(true);
  };

  const handleFreePlanSelect = async () => {
    const success = await updatePlan("free");
    if (success) {
      toast({
        title: "Free Plan selected!",
        description: "You can start using it right away",
      });
      onOpenChange(false);
    }
  };

  const isDowngrade = () => {
    if (!selectedPlan) return false;
    const currentPlanData = plans.find((p) => p.slug === currentPlan);
    if (!currentPlanData) return false;
    return selectedPlan.tier < currentPlanData.tier;
  };


  const handleConfirmPayment = async (paymentMethodId: string, discountCode?: string) => {
    if (!selectedPlan) return;

    setIsProcessing(true);
    try {
      const result = await createSubscription(
        selectedPlan.id,
        paymentMethodId,
        billingCycle,
        discountCode
      );

      if (result.success) {
        // Refresh plan access to update UI
        await refetchPlanAccess();
        await refetchSubscription();

        toast({
          title: "Payment successful! 🎉",
          description: `You have been upgraded to ${selectedPlan.name} Plan`,
        });

        // Mission 3: award points for upgrading to a paid plan (one-time)
        const { data: missionRaw, error: missionError } = await supabase.rpc(
          'award_loyalty_points',
          { p_action_type: 'upgrade_plan' }
        );
        const missionResult = missionRaw as { success?: boolean; points_awarded?: number } | null;
        if (missionResult?.success) {
          toast({
            title: '🎉 Mission Complete!',
            description: `+${missionResult.points_awarded} Points for upgrading your plan!`,
          });
          await refetchLoyalty();
          window.dispatchEvent(new CustomEvent('loyalty-refetch'));
        } else if (missionError) {
          void logError('PlanSelectionDialog.upgradeMission', new Error(missionError.message), {
            component: 'PlanSelectionDialog',
            code: missionError.code,
          });
          toast({
            variant: 'destructive',
            title: 'Plan upgraded',
            description:
              'Payment succeeded, but loyalty points could not be updated. Check Supabase env and migrations.',
          });
        }

        setShowPaymentDialog(false);
        onOpenChange(false);
      } else {
        toast({
          title: "Error",
          description: result.error || "Unable to complete. Please try again",
          variant: "destructive",
        });
        // Reset to plan selection for retry
        setShowPaymentDialog(false);
        setSelectedPlan(null);
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Unable to complete. Please try again",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const formatPrice = (price: number) => {
    if (price === 0) return "Free";
    return new Intl.NumberFormat("th-TH", {
      style: "currency",
      currency: "THB",
      minimumFractionDigits: 0,
    }).format(price);
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open && !showPaymentDialog} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold text-center">
              Choose the plan that suits you
            </DialogTitle>
            <p className="text-center text-muted-foreground">
              {currentPlan === "free"
                ? "Upgrade to unlock all features and boost your marketing efficiency"
                : "Manage your subscription or upgrade for more"}
            </p>
          </DialogHeader>

          {/* Billing Cycle Toggle - pill style */}
          <div className="flex items-center justify-center py-4">
            <Tabs
              value={billingCycle}
              onValueChange={(v) => setBillingCycle(v as BillingCycle)}
              className="w-auto"
            >
              <TabsList className="grid w-full grid-cols-2 gap-1 p-1 h-11 bg-muted/60">
                <TabsTrigger value="monthly" className="text-sm">
                  Monthly
                </TabsTrigger>
                <TabsTrigger value="yearly" className="text-sm gap-1.5">
                  Annually
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                    Save 17%
                  </Badge>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
            {plans.map((plan) => {
              const colors = planColors[plan.slug] || planColors.free;
              const isCurrentPlan = plan.slug === currentPlan;
              const isSelected = selectedPlan?.id === plan.id;
              const monthlyPrice = getMonthlyEquivalent(plan, billingCycle);
              const savings = getSavingsPercent(plan);

              return (
                <div
                  key={plan.id}
                  onClick={() => handleSelectPlan(plan)}
                  className={cn(
                    "relative rounded-xl border-2 p-5 cursor-pointer transition-all duration-200",
                    `bg-gradient-to-b ${colors.gradient}`,
                    isCurrentPlan && "ring-2 ring-primary/30",
                    isSelected
                      ? "border-primary shadow-lg shadow-primary/10 scale-[1.02]"
                      : "border-transparent hover:border-border hover:shadow-md"
                  )}
                >
                  {plan.is_popular && (
                    <Badge className="absolute -top-2 left-1/2 -translate-x-1/2 bg-primary">
                      Recommended
                    </Badge>
                  )}
                  {isCurrentPlan && (
                    <Badge variant="secondary" className="absolute -top-2 right-2">
                      Current Plan
                    </Badge>
                  )}

                  {/* Plan Header */}
                  <div className="text-center mb-4">
                    <div
                      className={cn(
                        "inline-flex items-center justify-center h-12 w-12 rounded-xl mb-3",
                        colors.bg
                      )}
                    >
                      <span className={colors.text}>
                        {planIcons[plan.slug] || <Zap className="h-5 w-5" />}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold">{plan.name}</h3>
                    <p className="text-xs text-muted-foreground">{plan.description}</p>
                  </div>

                  {/* Price */}
                  <div className="text-center mb-4">
                    <span className={cn("text-3xl font-bold", colors.text)}>
                      {formatPrice(monthlyPrice)}
                    </span>
                    {monthlyPrice > 0 && (
                      <span className="text-muted-foreground text-sm">/month</span>
                    )}
                    {billingCycle === "yearly" && savings > 0 && (
                      <p className="text-xs text-accent-foreground mt-1">
                        Save {savings}% with annual billing
                      </p>
                    )}
                  </div>

                  {/* Features */}
                  <div className="space-y-2.5">
                    {plan.features.map((feature, index) => (
                      <div key={index} className="flex items-center gap-2">
                        <div className="flex-shrink-0 h-4 w-4 rounded-full flex items-center justify-center bg-accent text-accent-foreground">
                          <Check className="h-3 w-3" />
                        </div>
                        <span className="text-xs text-foreground">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Select Button */}
                  <Button
                    className={cn(
                      "w-full mt-5",
                      isSelected
                        ? "bg-primary hover:bg-primary/90"
                        : plan.is_popular
                          ? "bg-primary/80 hover:bg-primary"
                          : "bg-muted-foreground/20 hover:bg-muted-foreground/30 text-foreground"
                    )}
                    variant={isSelected ? "default" : "outline"}
                  >
                    {isSelected
                      ? "Selected ✓"
                      : isCurrentPlan
                        ? "Current Plan"
                        : "Select this plan"}
                  </Button>
                </div>
              );
            })}
          </div>

          {/* Team Plan Extra Info */}
          <div className="mt-4 p-4 rounded-xl bg-violet-500/5 border border-violet-500/20">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/20">
                <Users className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Team Plan: Invite members to manage your store together
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Invite unlimited members to manage and handle the Marketing Dashboard together
                </p>
              </div>
            </div>
          </div>

          {/* Proceed Button */}
          <div className="flex flex-col items-center gap-2 mt-4">
            {selectedPlan && isDowngrade() && (
              <p className="text-xs text-muted-foreground text-center">
                To downgrade, please contact support.
              </p>
            )}
            <Button
              size="lg"
              className="px-8 min-w-[200px]"
              disabled={!selectedPlan || (selectedPlan.slug === currentPlan) || isDowngrade()}
              onClick={handleProceedToPayment}
            >
              {selectedPlan ? (
                selectedPlan.slug === currentPlan ? (
                  "You're on this plan"
                ) : selectedPlan.slug === "free" ? (
                  "Confirm Free Plan"
                ) : (
                  "Proceed to payment"
                )
              ) : (
                "Select a plan above"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Payment Method Dialog */}
      <PaymentMethodDialog
        open={showPaymentDialog}
        onOpenChange={(open) => {
          setShowPaymentDialog(open);
          if (!open) {
            setSelectedPlan(null);
          }
        }}
        selectedPlan={selectedPlan}
        billingCycle={billingCycle}
        paymentMethods={paymentMethods}
        onConfirmPayment={handleConfirmPayment}
        onBack={() => setShowPaymentDialog(false)}
        isProcessing={isProcessing}
      />
    </>
  );
}
