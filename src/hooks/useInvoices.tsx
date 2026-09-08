import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';

export interface Invoice {
  id: string;
  invoice_number: string | null;
  user_id: string;
  subscription_id: string | null;
  status: string | null;
  subtotal: number;
  tax_amount: number | null;
  discount_amount: number | null;
  total: number;
  due_date: string | null;
  paid_at: string | null;
  created_at: string | null;
  pdf_url: string | null;
  billing_details: Record<string, unknown> | null;
  line_items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }> | null;
  // Joined data
  subscription?: {
    billing_cycle: string | null;
    plan?: {
      name: string | null;
    };
  };
  currency?: {
    code: string;
    symbol: string | null;
  };
}

export function useInvoices() {
  const { data: invoices = [], isLoading, error } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const { data: { user } } = await getCurrentUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("invoices")
        .select(`
          *,
          subscriptions (
            billing_cycle,
            subscription_plans (name)
          ),
          currencies (code, symbol)
        `)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data || []).map(inv => ({
        ...inv,
        billing_details: inv.billing_details as Record<string, unknown> | null,
        line_items: inv.line_items as Invoice["line_items"],
        subscription: inv.subscriptions ? {
          billing_cycle: inv.subscriptions.billing_cycle,
          plan: inv.subscriptions.subscription_plans,
        } : undefined,
        currency: inv.currencies,
      })) as Invoice[];
    },
  });

  const getStatusLabel = (status: string | null): string => {
    switch (status) {
      case "paid": return "ชำระแล้ว";
      case "pending": return "รอชำระ";
      case "overdue": return "เกินกำหนด";
      case "cancelled": return "ยกเลิก";
      case "draft": return "ฉบับร่าง";
      default: return status || "ไม่ทราบ";
    }
  };

  const getStatusColor = (status: string | null): string => {
    switch (status) {
      case "paid": return "bg-success/10 text-success border-success/20";
      case "pending": return "bg-warning/10 text-warning border-warning/20";
      case "overdue": return "bg-destructive/10 text-destructive border-destructive/20";
      case "cancelled": return "bg-muted text-muted-foreground";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const formatCurrency = (amount: number, currency?: { code: string; symbol: string | null }): string => {
    const symbol = currency?.symbol || "฿";
    return `${symbol}${amount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}`;
  };

  return {
    invoices,
    isLoading,
    error,
    getStatusLabel,
    getStatusColor,
    formatCurrency,
  };
}
