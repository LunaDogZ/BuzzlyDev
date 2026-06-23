import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, Crown, Users, Zap, Lock, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlanType, usePlanAccess } from "@/hooks/usePlanAccess";
import { toast } from "@/hooks/use-toast";
import { useSubscription, BillingCycle } from "@/hooks/useSubscription";
import { PaymentMethodDialog } from "@/components/subscription/PaymentMethodDialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useLoyaltyTier } from "@/hooks/useLoyaltyTier";
import { supabase } from "@/integrations/supabase/client";
import { logError } from "@/services/errorLogger";

interface UpgradeRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  requiredPlan: PlanType;
  featureName: string;
  featureDescription?: string;
}

import { PLANS, PlanConfig } from "@/constants/plans";

// Helper to map PLANS constant to PlanDisplay format
const planDisplays = Object.values(PLANS).map((plan) => ({
  id: plan.id,
  name: plan.name,
  price: plan.price.monthly === 0 ? "Free" : `฿${plan.price.monthly.toLocaleString()}`,
  priceYearly: plan.price.yearly === 0 ? "Free" : `฿${plan.price.yearly.toLocaleString()}`,
  period: "/month",
  description: plan.description,
  icon: <plan.icon className="h-5 w-5" />, // Instantiate icon component
  color: plan.color,
  bgGradient: plan.bgGradient,
  popular: plan.popular,
  features: plan.features,
}));


export function UpgradeRequiredDialog({
  open,
  onOpenChange,
  requiredPlan,
  featureName,
  featureDescription,
}: UpgradeRequiredDialogProps) {
  const [selectedPlanType, setSelectedPlanType] = useState<PlanType | null>(requiredPlan);
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // UpgradeRequiredDialog defaults to monthly, but we should allow toggling
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  const { currentPlan, updatePlan, refetch: refetchPlanAccess } = usePlanAccess();
  const {
    plans: subscriptionPlans,
    paymentMethods,
    createSubscription,
    refetch: refetchSubscription,
    loading: subscriptionLoading
  } = useSubscription();
  const { refetch: refetchLoyalty } = useLoyaltyTier();

  useEffect(() => {
    if (open) {
      setSelectedPlanType(requiredPlan);
      setShowPaymentDialog(false);
    }
  }, [open, requiredPlan]);

  const handleSelectPlan = (planId: PlanType) => {
    // Don't allow selecting current plan or lower
    const planOrder: PlanType[] = ["free", "pro", "team"];
    const currentIndex = planOrder.indexOf(currentPlan);
    const selectedIndex = planOrder.indexOf(planId);

    if (selectedIndex > currentIndex) {
      setSelectedPlanType(planId);
    }
  };

  const handleProceed = async () => {
    if (!selectedPlanType || selectedPlanType === currentPlan) return;

    // If Free plan (unlikely in upgrade dialog but good for safety), update directly
    if (selectedPlanType === "free") {
      const success = await updatePlan("free");
      if (success) {
        toast({
          title: "Downgrade successful",
          description: "You have switched back to Free Plan",
        });
        onOpenChange(false);
      }
      return;
    }

    // For paid plans, show payment dialog
    setShowPaymentDialog(true);
  };

  const handleConfirmPayment = async (paymentMethodId: string, discountCode?: string) => {
    if (!selectedPlanType) return;

    // Find the real plan object from subscriptionPlans
    const realPlan = subscriptionPlans.find(p => p.slug === selectedPlanType);

    if (!realPlan) {
      toast({
        title: "Error",
        description: "Plan not found. Please try again",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const result = await createSubscription(
        realPlan.id,
        paymentMethodId,
        billingCycle,
        discountCode
      );

      if (result.success) {
        // Refresh plan access to update UI
        await refetchPlanAccess();
        await refetchSubscription();

        toast({
          title: "Upgrade successful! 🎉",
          description: `You have been upgraded to ${selectedPlanType.toUpperCase()} Plan`,
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
        } else if (missionError) {
          void logError('UpgradeRequiredDialog.upgradeMission', new Error(missionError.message), {
            component: 'UpgradeRequiredDialog',
            code: missionError.code,
          });
          toast({
            variant: 'destructive',
            title: 'Upgrade successful',
            description:
              'Plan changed, but loyalty points could not be updated. Check Supabase env and migrations.',
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

  const planOrder: PlanType[] = ["free", "pro", "team"];
  const currentPlanIndex = planOrder.indexOf(currentPlan);

  // Find the currently selected real plan for passing to PaymentMethodDialog
  const selectedRealPlan = subscriptionPlans.find(p => p.slug === selectedPlanType) || null;

  return (
    <>
      <Dialog open={open && !showPaymentDialog} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {subscriptionLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Lock className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">
                      This feature requires a plan upgrade
                    </DialogTitle>
                  </div>
                </div>

                {/* Feature Info Banner */}
                <div className="rounded-lg bg-gradient-to-r from-primary/10 to-primary/5 p-4 mt-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-foreground">{featureName}</p>
                      {featureDescription && (
                        <p className="text-sm text-muted-foreground mt-1">
                          {featureDescription}
                        </p>
                      )}
                      <p className="text-sm text-primary mt-2">
                        Requires <span className="font-semibold">{requiredPlan.toUpperCase()}</span> Plan or higher
                      </p>
                    </div>
                  </div>
                </div>
              </DialogHeader>

              <div className="flex items-center justify-center gap-4 py-4">
                <Label
                  htmlFor="upgrade-billing-toggle"
                  className={cn(
                    "cursor-pointer",
                    billingCycle === "monthly" ? "font-semibold" : "text-muted-foreground"
                  )}
                >
                  Monthly
                </Label>
                <Switch
                  id="upgrade-billing-toggle"
                  checked={billingCycle === "yearly"}
                  onCheckedChange={(checked) =>
                    setBillingCycle(checked ? "yearly" : "monthly")
                  }
                />
                <Label
                  htmlFor="upgrade-billing-toggle"
                  className={cn(
                    "cursor-pointer flex items-center gap-2",
                    billingCycle === "yearly" ? "font-semibold" : "text-muted-foreground"
                  )}
                >
                  Annually
                  <Badge variant="secondary" className="bg-accent text-accent-foreground">
                    -17%
                  </Badge>
                </Label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                {planDisplays.map((plan) => {
                  const planIndex = planOrder.indexOf(plan.id);
                  const isCurrentPlan = plan.id === currentPlan;
                  const isLowerPlan = planIndex <= currentPlanIndex;
                  const isSelectable = !isLowerPlan;

                  return (
                    <div
                      key={plan.id}
                      onClick={() => isSelectable && handleSelectPlan(plan.id)}
                      className={cn(
                        "relative rounded-xl border-2 p-5 transition-all duration-200",
                        `bg-gradient-to-b ${plan.bgGradient}`,
                        isCurrentPlan && "ring-2 ring-muted",
                        isLowerPlan && "opacity-50 cursor-not-allowed",
                        !isLowerPlan && "cursor-pointer",
                        selectedPlanType === plan.id && !isLowerPlan
                          ? "border-primary shadow-lg scale-[1.02]"
                          : "border-transparent hover:border-border hover:shadow-md"
                      )}
                    >
                      {plan.popular && (
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
                            plan.id === "free" && "bg-muted",
                            plan.id === "pro" && "bg-primary/20",
                            plan.id === "team" && "bg-violet-500/20"
                          )}
                        >
                          <span className={plan.color}>{plan.icon}</span>
                        </div>
                        <h3 className="text-lg font-bold">{plan.name}</h3>
                        <p className="text-xs text-muted-foreground">{plan.description}</p>
                      </div>

                      {/* Price */}
                      <div className="text-center mb-4">
                        <span className={cn("text-3xl font-bold", plan.color)}>
                          {billingCycle === "yearly" ? plan.priceYearly : plan.price}
                        </span>
                        <span className="text-muted-foreground text-sm">{plan.period}</span>
                        {billingCycle === "yearly" && plan.id !== "free" && (
                          <div className="mt-1">
                            <Badge variant="outline" className="text-xs border-green-500 text-green-500">
                              Save ~17%
                            </Badge>
                          </div>
                        )}
                      </div>

                      {/* Features */}
                      <div className="space-y-2.5">
                        {plan.features.map((feature, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <div
                              className={cn(
                                "flex-shrink-0 h-4 w-4 rounded-full flex items-center justify-center",
                                feature.included
                                  ? "bg-emerald-500/20 text-emerald-600"
                                  : "bg-muted text-muted-foreground"
                              )}
                            >
                              {feature.included ? (
                                <Check className="h-3 w-3" />
                              ) : (
                                <span className="text-[10px]">-</span>
                              )}
                            </div>
                            <span
                              className={cn(
                                "text-xs",
                                feature.included
                                  ? "text-foreground"
                                  : "text-muted-foreground line-through"
                              )}
                            >
                              {feature.name}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* Select Button */}
                      {!isLowerPlan && (
                        <Button
                          className={cn(
                            "w-full mt-5",
                            selectedPlanType === plan.id
                              ? "bg-primary hover:bg-primary/90"
                              : plan.id === "pro"
                                ? "bg-primary/80 hover:bg-primary"
                                : "bg-muted-foreground/20 hover:bg-muted-foreground/30 text-foreground"
                          )}
                          variant={selectedPlanType === plan.id ? "default" : "outline"}
                        >
                          {selectedPlanType === plan.id ? "Selected ✓" : "Select this plan"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Team Plan Extra Info */}
              <div className="mt-4 p-4 rounded-lg bg-violet-500/10 border border-violet-500/20">
                <div className="flex items-start gap-3">
                  <Users className="h-5 w-5 text-violet-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Team Plan: Invite members to manage your store together
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Invite up to 5 members to manage and handle the Marketing Dashboard together
                    </p>
                  </div>
                </div>
              </div>

              {/* Confirm Button */}
              <div className="flex justify-center mt-4">
                <Button
                  size="lg"
                  className="px-8"
                  disabled={!selectedPlanType || selectedPlanType === currentPlan}
                  onClick={handleProceed}
                >
                  {selectedPlanType && selectedPlanType !== currentPlan
                    ? `Upgrade to ${planDisplays.find((p) => p.id === selectedPlanType)?.name}`
                    : "Please select a plan to upgrade"}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <PaymentMethodDialog
        open={showPaymentDialog}
        onOpenChange={(open) => {
          setShowPaymentDialog(open);
        }}
        selectedPlan={selectedRealPlan}
        billingCycle={billingCycle}
        paymentMethods={paymentMethods}
        onConfirmPayment={handleConfirmPayment}
        onBack={() => setShowPaymentDialog(false)}
        isProcessing={isProcessing}
      />
    </>
  );
}

