import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/utils";
// Static, not `await import(...)`: 19 other modules already import this
// statically, so the dynamic form could never move it into its own chunk — it
// only made the build warn. One or the other, and static is what the codebase
// already does everywhere else.
import { auditDiscount } from "@/lib/auditLogger";

export interface SubscriptionPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  limits: Record<string, number>;
  is_popular: boolean;
  is_active: boolean;
  display_order: number;
  trial_days: number;
  tier: number; // ต้องมี column นี้ใน DB
}

export interface PaymentMethod {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  icon_url: string | null;
  display_order: number;
  is_active: boolean;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: string;
  billing_cycle: "monthly" | "yearly";
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export type BillingCycle = "monthly" | "yearly";

export function useSubscription() {
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [currentSubscription, setCurrentSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      setUserId(user?.id || null);

      // Fetch Plans
      const { data: plansData, error: plansError } = await supabase
        .from("subscription_plans")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      if (plansError) throw plansError;

      const formattedPlans: SubscriptionPlan[] = (plansData || [])
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          slug: plan.slug || plan.name.toLowerCase(),
          description: plan.description,
          price_monthly: Number(plan.price_monthly) || 0,
          price_yearly: Number(plan.price_yearly) || 0,
          features: Array.isArray(plan.features)
            ? (plan.features as unknown[]).map((f) => String(f))
            : [],
          limits: typeof plan.limits === "object" && plan.limits !== null
            ? (plan.limits as Record<string, number>)
            : {},
          is_popular: plan.is_popular || false,
          is_active: plan.is_active ?? true,
          display_order: plan.display_order || 0,
          trial_days: plan.trial_days || 0,
          // Map tier from slug to ensure correct ordering even if DB is missing tier column
          tier: plan.slug === 'team' ? 3 : plan.slug === 'pro' ? 2 : 1,
        }))
        .filter((plan) => ["free", "pro", "team"].includes(plan.slug));

      setPlans(formattedPlans);

      // Fetch Payment Methods
      const { data: methodsData, error: methodsError } = await supabase
        .from("payment_methods")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      if (methodsError) throw methodsError;
      // Deduplicate by name (case-insensitive) — catches duplicates even when slugs differ
      const seenNames = new Set<string>();
      const uniqueMethods = (methodsData || []).filter((m) => {
        const key = (m.name || "").toLowerCase();
        if (seenNames.has(key)) return false;
        seenNames.add(key);
        return true;
      });
      setPaymentMethods(uniqueMethods);

      // Fetch Active Subscription
      if (user) {
        const { data: subData } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("user_id", user.id)
          .eq("status", "active") // ดึงเฉพาะตัวที่ Active อยู่
          .single();

        if (subData) {
          setCurrentSubscription({
            id: subData.id,
            user_id: subData.user_id,
            plan_id: subData.plan_id,
            status: subData.status || "active",
            billing_cycle: (subData.billing_cycle as BillingCycle) || "monthly",
            current_period_start: subData.current_period_start,
            current_period_end: subData.current_period_end,
            cancel_at_period_end: subData.cancel_at_period_end || false,
          });
        }
      }
    } catch (error) {
      console.error("Error fetching subscription data:", error);
    } finally {
      setLoading(false);
    }
  };

  const getPrice = (plan: SubscriptionPlan, cycle: BillingCycle): number => {
    return cycle === "yearly" ? plan.price_yearly : plan.price_monthly;
  };

  const getMonthlyEquivalent = (plan: SubscriptionPlan, cycle: BillingCycle): number => {
    if (cycle === "yearly") {
      return Math.round(plan.price_yearly / 12);
    }
    return plan.price_monthly;
  };

  const getSavingsPercent = (plan: SubscriptionPlan): number => {
    if (plan.price_monthly === 0) return 0;
    const yearlyMonthly = plan.price_yearly / 12;
    const savings = ((plan.price_monthly - yearlyMonthly) / plan.price_monthly) * 100;
    return Math.round(savings);
  };

  const getUserCreditBalance = async (userId: string): Promise<number> => {
    // Note: The 'subscription_credit_balance' column has been dropped from the 'customer' table 
    // in migration 20260224000001_drop_customer_legacy_columns.sql.
    // If a new wallet/credit system is implemented, this function should query that system instead.
    // For now, return 0 to prevent schema errors during plan changes.
    return 0;
  };

  const createSubscription = async (
    planId: string,
    paymentMethodId: string,
    billingCycle: BillingCycle,
    discountCode?: string
  ): Promise<{ success: boolean; subscriptionId?: string; error?: string }> => {
    console.log("Creating subscription:", { planId, billingCycle, userId, discountCode });
    if (!userId) {
      return { success: false, error: "Please sign in first" };
    }

    try {
      // 1. ตรวจสอบ Plan ใหม่
      const newPlan = plans.find((p) => p.id === planId);
      if (!newPlan) {
        return { success: false, error: "Selected plan not found" };
      }

      // 2. ดึงข้อมูล Subscription ปัจจุบัน (ดึงทั้งหมดที่เป็น active เพื่อป้องกันเคสมีซ้ำ)
      const { data: currentSubs } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("status", "active");

      let isUpgrade = false;
      let chargeAmount: number;
      let newCreditBalance = 0;

      // ถ้ามี Subscription เดิม (อาจจะมีหลาย row ถ้า data ผิดพลาด) เราจะ loop ปิดให้หมด
      if (currentSubs && currentSubs.length > 0) {
        // ใช้ตัวแรกเป็นตัวหลักในการคำนวณ Credit
        const mainSub = currentSubs[0];

        // --- กรณีมี Plan เดิม (Upgrade) ---
        const currentPlan = plans.find((p) => p.id === mainSub.plan_id);

        if (currentPlan) {
          // กฎ: ห้าม Downgrade (เช็คแค่ตัวหลัก)
          if (newPlan.tier < currentPlan.tier) {
            return { success: false, error: "Cannot downgrade to a lower plan" };
          }
          isUpgrade = newPlan.tier > currentPlan.tier;

          // คำนวณ Proration (ส่วนลดจากวันคงเหลือ)
          const existingCredit = await getUserCreditBalance(userId);

          let timeCredit = 0;
          if (mainSub.current_period_start && mainSub.current_period_end) {
            const start = new Date(mainSub.current_period_start);
            const end = new Date(mainSub.current_period_end);
            const now = new Date();

            const totalMs = end.getTime() - start.getTime();
            const remainingMs = Math.max(0, end.getTime() - now.getTime());
            const fractionRemaining = totalMs > 0 ? remainingMs / totalMs : 0;

            const currentPrice = getPrice(
              currentPlan,
              (mainSub.billing_cycle as BillingCycle) || "monthly"
            );
            timeCredit = Number((currentPrice * fractionRemaining).toFixed(2));
          }

          const effectiveCredit = existingCredit + timeCredit;
          const newPrice = getPrice(newPlan, billingCycle);

          // ราคาสุทธิที่ต้องจ่าย และ เครดิตที่จะเก็บไว้รอบหน้า
          chargeAmount = Math.max(0, Number((newPrice - effectiveCredit).toFixed(2)));
          newCreditBalance = Math.max(0, Number((effectiveCredit - newPrice).toFixed(2)));
        } else {
          // Fallback ถ้าหา Plan เก่าไม่เจอ ให้คิดราคาเต็ม
          chargeAmount = getPrice(newPlan, billingCycle);
        }

        // ปิด Plan เก่า "ทุกตัว" ที่ active อยู่
        for (const sub of currentSubs) {
          const { error: updateOldSubError } = await supabase
            .from("subscriptions")
            .update({
              status: "upgraded",
              cancel_at_period_end: false,
              cancelled_at: new Date().toISOString(),
            })
            .eq("id", sub.id);

          if (updateOldSubError) console.error("Error closing old sub:", updateOldSubError);
        }

      } else {
        // --- กรณีสมัครใหม่ (New Subscription) ---
        const newPrice = getPrice(newPlan, billingCycle);
        chargeAmount = newPrice;
        newCreditBalance = 0;
      }

      // --- Apply Discount if provided (atomic: validate + mark used + increment count) ---
      let appliedDiscountAmount = 0;
      let appliedDiscountId: string | undefined = undefined;
      if (discountCode) {
        // apply_collected_discount is SECURITY DEFINER and uses FOR UPDATE to prevent
        // double-spend race conditions. It also marks used_at and increments usage_count.
        const { data: discountRaw, error: discountErr } = await supabase.rpc(
          "apply_collected_discount",
          { p_code: discountCode }
        );
        const discountResult = discountRaw as { error?: string; id?: string; code?: string; discount_type?: "percent" | "fixed"; discount_value?: number; min_order_value?: number; max_discount_amount?: number | null } | null;

        if (discountErr) {
          console.error("Error applying discount:", discountErr);
        } else if (discountResult && !discountResult.error) {
          const d = discountResult as {
            id?: string;
            code?: string;
            discount_type: "percent" | "fixed";
            discount_value: number;
            min_order_value: number;
            max_discount_amount: number | null;
          };
          const { data: { user } } = await supabase.auth.getUser();
          if (user) auditDiscount.customerUsed(user.id, d.code || discountCode, d.id);
          let rawDiscount = 0;
          if (d.discount_type === "percent") {
            rawDiscount = (chargeAmount * d.discount_value) / 100;
            if (d.max_discount_amount) {
              rawDiscount = Math.min(rawDiscount, d.max_discount_amount);
            }
          } else {
            rawDiscount = d.discount_value;
          }
          appliedDiscountAmount = Math.min(rawDiscount, chargeAmount);
          chargeAmount = chargeAmount - appliedDiscountAmount;
          appliedDiscountId = d.id;
        } else if (discountResult?.error) {
          // Discount code was validated in dialog but something changed server-side (e.g. race).
          // Log but do NOT abort the payment — customer already confirmed.
          console.warn("Discount could not be applied at payment time:", discountResult.error);
        }
      }

      // 3. สร้าง Subscription ใหม่ (เริ่มนับ 1 ใหม่ทันทีตามกฎข้อ 3)
      const now = new Date();
      const periodEnd = new Date(now);

      if (billingCycle === "yearly") {
        periodEnd.setFullYear(periodEnd.getFullYear() + 1);
      } else {
        periodEnd.setMonth(periodEnd.getMonth() + 1);
      }

      const { data: subscription, error: subError } = await supabase
        .from("subscriptions")
        .insert({
          user_id: userId,
          plan_id: planId,
          status: "active", // ต้องเป็น Active
          billing_cycle: billingCycle,
          current_period_start: now.toISOString(), // เริ่มวันนี้
          current_period_end: periodEnd.toISOString(),
        })
        .select()
        .single();

      if (subError) throw subError;

      // 4. บันทึก Transaction (Mock Payment)
      const { data: currency } = await supabase
        .from("currencies")
        .select("id")
        .eq("code", "THB") // ใช้ THB
        .maybeSingle(); // ใช้ maybeSingle เพื่อกัน error ถ้าไม่เจอ

      const { error: txnError } = await supabase
        .from("payment_transactions")
        .insert({
          user_id: userId,
          subscription_id: subscription.id,
          payment_method_id: paymentMethodId,
          amount: chargeAmount,
          discount_amount: appliedDiscountAmount,
          discount_id: appliedDiscountId,
          currency_id: currency?.id,
          status: "completed",
          transaction_type: isUpgrade ? "subscription_upgrade" : "subscription",
          payment_gateway: "mock",
          gateway_transaction_id: `mock_${Date.now()}`,
        });

      if (txnError) throw txnError;

      // 4.5 สร้าง Invoice อัตโนมัติ
      const invoiceNumber = `INV-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${Date.now().toString().slice(-6)}`;
      const { error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          user_id: userId,
          subscription_id: subscription.id,
          invoice_number: invoiceNumber,
          status: "paid",
          subtotal: chargeAmount + appliedDiscountAmount,
          tax_amount: 0,
          discount_amount: appliedDiscountAmount,
          total: chargeAmount,
          currency_id: currency?.id,
          due_date: now.toISOString(),
          paid_at: now.toISOString(),
          line_items: [{
            description: `${newPlan.name} Plan - ${billingCycle === "yearly" ? "Annually" : "Monthly"}`,
            quantity: 1,
            unit_price: chargeAmount + appliedDiscountAmount,
            total: chargeAmount + appliedDiscountAmount,
          }],
        });

      if (invoiceError) {
        console.error("Warning: Invoice creation failed", invoiceError);
      }

      // Note: discount used_at and usage_count are already updated atomically
      // inside the apply_collected_discount RPC above.

      // 5. อัปเดต Profile (แก้ปัญหา UI เด้งกลับเป็น Free)
      // `.select("id")` ไม่ได้มีไว้เอาค่ากลับมาใช้ — มีไว้ให้รู้ว่า UPDATE โดนกี่แถว.
      // UPDATE ที่ไม่ตรงแถวไหนเลยคือ "สำเร็จ" ในสายตา PostgREST (error = null) ดังนั้น
      // ถ้าไม่นับแถว การอัปเกรดแพลนบนบัญชีที่ไม่มีแถวใน customer จะเงียบสนิท แล้ว UI
      // ก็เด้งกลับเป็น Free ตามคอมเมนต์ข้างบน — ซึ่งเคยเกิดจริงมาแล้ว (migration
      // 20260906091500: handle_new_user เขียนแถว customer ไม่สำเร็จมาตลอด 6 เดือน)
      const { data: updatedCustomer, error: profileError } = await supabase
        .from("customer")
        .update({
          plan_type: newPlan.slug, // เช่น 'pro', 'team'
          // 'subscription_credit_balance' has been dropped, do not try to update it
          updated_at: new Date().toISOString()
        })
        .eq("id", userId)
        .select("id");

      if (profileError) {
        // Throw error เพื่อให้ createSubscription fail ชัดเจน แทนที่จะ silent fail
        // หาก error นี้เกิดขึ้น ให้ตรวจสอบ RLS policy ของ customer table
        console.error("Profile update failed (RLS or schema issue):", profileError);
        throw profileError;
      }

      if (!updatedCustomer || updatedCustomer.length === 0) {
        throw new Error(
          `อัปเดตแพลนไม่สำเร็จ: ไม่พบแถวของผู้ใช้ ${userId} ในตาราง customer ` +
          `(ผู้ใช้อาจสมัครไว้ตอนที่ trigger handle_new_user ยังพัง หรือถูก RLS ซ่อนไว้)`
        );
      }

      // 6. Refresh ข้อมูลหน้าจอใหม่แบบเงียบๆ
      await fetchData(true);

      return { success: true, subscriptionId: subscription.id };

    } catch (error) {
      console.error("Error creating subscription:", error);
      return { success: false, error: getErrorMessage(error) };
    }
  };

  const cancelSubscription = async (): Promise<boolean> => {
    if (!currentSubscription) return false;

    try {
      const { error } = await supabase
        .from("subscriptions")
        .update({
          cancel_at_period_end: true,
          cancelled_at: new Date().toISOString(),
        })
        .eq("id", currentSubscription.id);

      if (error) throw error;

      await fetchData(true);
      return true;
    } catch (error) {
      console.error("Error cancelling subscription:", error);
      return false;
    }
  };

  return {
    plans,
    paymentMethods,
    currentSubscription,
    loading,
    userId,
    getPrice,
    getMonthlyEquivalent,
    getSavingsPercent,
    createSubscription,
    cancelSubscription,
    refetch: (silent = false) => fetchData(silent),
  };
}