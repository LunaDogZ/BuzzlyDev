import { useState } from "react";
import { getErrorMessage } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CreditCard,
  Download,
  Check,
  Star,
  Crown,
  FileText,
  Calendar,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { useSubscription, BillingCycle } from "@/hooks/useSubscription";
import { useInvoices } from "@/hooks/useInvoices";
import { useUserPaymentMethods } from "@/hooks/useUserPaymentMethods";
import { usePlanContext } from "@/contexts/PlanContext";
import { PaymentMethodDialog } from "@/components/subscription/PaymentMethodDialog";

interface BillingTabProps {
  onNavigateToPaymentMethods?: () => void;
}

export function BillingTab({ onNavigateToPaymentMethods }: BillingTabProps) {
  const {
    plans,
    paymentMethods,
    currentSubscription,
    loading: subLoading,
    getPrice,
    getSavingsPercent,
    createSubscription,
    cancelSubscription,
    refetch: refetchSubscriptionData,
  } = useSubscription();

  const {
    invoices,
    isLoading: invoicesLoading,
    getStatusLabel,
    getStatusColor,
    formatCurrency,
  } = useInvoices();

  const { refetch: refetchPlan } = usePlanContext();

  const [billingCycle, setBillingCycle] = useState<"monthly" | "yearly">("monthly");
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  const currentPlan = plans.find(p => p.id === currentSubscription?.plan_id);

  const handleUpgrade = (planId: string) => {
    setSelectedPlanId(planId);
    setPaymentDialogOpen(true);
  };

  const handlePaymentConfirm = async (methodId: string, discountCode?: string) => {
    if (!selectedPlanId) return;
    setIsProcessingPayment(true);
    try {
      const result = await createSubscription(selectedPlanId, methodId, billingCycle, discountCode);
      if (result.success) {
        toast.success("Payment successful. Plan updated.");
        setPaymentDialogOpen(false);
        setSelectedPlanId(null);
        await refetchSubscriptionData(true); // Silent update local subscription state for the UI
        await refetchPlan(true); // Silent update global plan state
      } else {
        toast.error(result.error || "Payment failed");
      }
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const handleCancelPlan = async () => {
    if (!confirm("Do you want to cancel your current plan? Benefits will end at the end of the billing period.")) return;
    const success = await cancelSubscription();
    if (success) {
      await refetchSubscriptionData(true); // Silent update local subscription state for the UI
      await refetchPlan(true); // Silent update global plan state
    }
  };

  const scrollToPlans = () => {
    document.getElementById("plans-section")?.scrollIntoView({ behavior: "smooth" });
  };

  if (subLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Current Plan */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Current plan</CardTitle>
              <CardDescription>
                {currentPlan ? `You are on the ${currentPlan.name} plan` : "You have not subscribed to a plan yet"}
              </CardDescription>
            </div>
            {currentPlan && (
              <Badge className="bg-primary gap-1">
                <Crown className="h-3 w-3" />
                {currentPlan.name}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {currentPlan ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold">
                  ฿{getPrice(currentPlan, currentSubscription?.billing_cycle || "monthly").toLocaleString()}
                  <span className="text-lg font-normal text-muted-foreground">
                    /{currentSubscription?.billing_cycle === "yearly" ? "year" : "month"}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  {currentSubscription?.billing_cycle === "yearly" ? "Annual" : "Monthly"} billing •
                  Next bill: {currentSubscription?.current_period_end
                    ? new Date(currentSubscription.current_period_end).toLocaleDateString()
                    : "-"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={scrollToPlans}>Change plan</Button>
                {currentSubscription?.cancel_at_period_end ? (
                  <Badge variant="destructive">Cancels at end of billing period</Badge>
                ) : (
                  <Button variant="ghost" className="text-destructive" onClick={handleCancelPlan}>Cancel plan</Button>
                )}
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">Select a plan below to get started</p>
          )}
        </CardContent>
      </Card>

      {/* Billing Cycle Toggle */}
      <div className="flex justify-center">
        <Tabs value={billingCycle} onValueChange={(v) => setBillingCycle(v as "monthly" | "yearly")}>
          <TabsList>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
            <TabsTrigger value="yearly" className="gap-2">
              Yearly
              <Badge variant="secondary" className="text-xs">
                Save up to 17%
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Plans */}
      <div id="plans-section" className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrentPlan = currentPlan?.id === plan.id;
          const savings = getSavingsPercent(plan);
          const isDowngrade = currentPlan ? plan.tier < currentPlan.tier : false;

          return (
            <Card
              key={plan.id}
              className={`relative border-0 shadow-sm ${plan.is_popular ? "ring-2 ring-primary" : ""}`}
            >
              {plan.is_popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="gap-1">
                    <Star className="h-3 w-3" />
                    Popular
                  </Badge>
                </div>
              )}
              <CardHeader className="pt-6">
                <CardTitle className="flex items-center justify-between">
                  {plan.name}
                  {isCurrentPlan && <Badge variant="outline">Current</Badge>}
                </CardTitle>
                <div className="mt-2">
                  <span className="text-3xl font-bold">
                    ฿{getPrice(plan, billingCycle).toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">
                    /{billingCycle === "yearly" ? "year" : "month"}
                  </span>
                </div>
                {billingCycle === "yearly" && savings > 0 && (
                  <p className="text-sm text-success">Save 17%</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <Separator />
                <ul className="space-y-2">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm">
                      <Check className="h-4 w-4 text-success mt-0.5 shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  variant={isCurrentPlan ? "outline" : "default"}
                  disabled={isCurrentPlan || isDowngrade}
                  onClick={() => handleUpgrade(plan.id)}
                >
                  {isCurrentPlan ? "Current plan" : isDowngrade ? "Cannot downgrade" : "Select plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Payment Method */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Payment method
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PaymentMethodDisplay onNavigate={onNavigateToPaymentMethods} />
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card className="border-0 shadow-sm rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Invoice history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : invoices.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No invoices yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.slice(0, 5).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      {invoice.invoice_number || invoice.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {invoice.created_at
                          ? new Date(invoice.created_at).toLocaleDateString()
                          : "-"}
                      </div>
                    </TableCell>
                    <TableCell>
                      {invoice.subscription?.plan?.name || "Subscription"}
                    </TableCell>
                    <TableCell>
                      <Badge className={getStatusColor(invoice.status)}>
                        {getStatusLabel(invoice.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(invoice.total, invoice.currency)}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon">
                        <Download className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {invoices.length > 5 && (
            <div className="mt-4 text-center">
              <Button variant="link" className="gap-1">
                View all
                <ArrowUpRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      <PaymentMethodDialog
        open={paymentDialogOpen}
        onOpenChange={setPaymentDialogOpen}
        selectedPlan={plans.find(p => p.id === selectedPlanId) || null}
        billingCycle={billingCycle}
        paymentMethods={paymentMethods}
        onConfirmPayment={handlePaymentConfirm}
        onBack={() => setPaymentDialogOpen(false)}
        isProcessing={isProcessingPayment}
      />
    </div >
  );
}

function PaymentMethodDisplay({ onNavigate }: { onNavigate?: () => void }) {
  const { defaultMethod, isLoading } = useUserPaymentMethods();

  if (isLoading) {
    return <Skeleton className="h-20 w-full" />;
  }

  if (!defaultMethod) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center border rounded-lg border-dashed">
        <CreditCard className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-sm text-muted-foreground">No default payment method</p>
        <Button
          variant="link"
          className="text-primary mt-2"
          onClick={() => onNavigate?.()}
        >
          Add payment method
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="flex items-center gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-medium">
            {defaultMethod.card_brand
              ? `${defaultMethod.card_brand} •••• ${defaultMethod.card_last_four}`
              : (defaultMethod.bank_name || "Payment Method")}
          </p>
          {defaultMethod.card_exp_month && defaultMethod.card_exp_year && (
            <p className="text-sm text-muted-foreground">
              Expires {String(defaultMethod.card_exp_month).padStart(2, '0')}/{defaultMethod.card_exp_year}
            </p>
          )}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => onNavigate?.()}
      >
        Manage
      </Button>
    </div>
  );
}
