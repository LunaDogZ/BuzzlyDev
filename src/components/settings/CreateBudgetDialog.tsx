import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { useBudgets } from "@/hooks/useBudgets";
import { useCampaigns } from "@/hooks/useCampaigns";

interface CreateBudgetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateBudgetDialog({ open, onOpenChange }: CreateBudgetDialogProps) {
  const { createBudget } = useBudgets();
  const [formData, setFormData] = useState({
    name: "",
    budget_type: "daily" as "daily" | "monthly" | "lifetime",
    campaign_id: "" as string,
    amount: "",
    currency_id: "THB", // Default
    start_date: "",
    end_date: "",
    alert_threshold_percent: 80,
  });

  const { campaigns } = useCampaigns();

  const handleSubmit = async (e: React.FormEvent | React.MouseEvent) => {
    e.preventDefault();
    
    // Simple validation
    if (!formData.name || !formData.budget_type || !formData.amount) {
      alert("Please fill in all required fields.");
      return;
    }

    try {
      await createBudget.mutateAsync({
        name: formData.name,
        budget_type: formData.budget_type,
        campaign_id: (formData.campaign_id && formData.campaign_id !== "none") ? formData.campaign_id : null,
        amount: parseFloat(formData.amount),
        currency: formData.currency_id,
        start_date: formData.start_date || null,
        end_date: formData.end_date || null,
        alert_threshold_percent: formData.alert_threshold_percent,
      });

      // Clear form on success
      setFormData({
        name: "",
        budget_type: "daily",
        campaign_id: "",
        amount: "",
        currency_id: "THB",
        start_date: "",
        end_date: "",
        alert_threshold_percent: 80,
      });
      
      onOpenChange(false);
    } catch (error) {
      console.error("Error creating budget:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] rounded-[2rem] p-0 border-none shadow-2xl flex flex-col overflow-hidden">
        <DialogHeader className="p-8 pb-0">
          <DialogTitle className="text-2xl font-black uppercase tracking-tight">Create New Budget</DialogTitle>
          <DialogDescription className="text-muted-foreground font-medium">
            Set up marketing budgets to track spending in real time
          </DialogDescription>
        </DialogHeader>
        
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-8 py-4">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Budget Name *</Label>
              <Input
                id="name"
                placeholder="e.g. Q1 Marketing Budget"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="h-12 rounded-2xl bg-muted/30 border-none ring-1 ring-border shadow-none focus-visible:ring-primary focus-visible:ring-2 transition-all"
                required
              />
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Select Campaign (Optional)</Label>
              <Select
                value={formData.campaign_id}
                onValueChange={(v) => setFormData({ ...formData, campaign_id: v })}
              >
                <SelectTrigger className="h-12 rounded-2xl bg-muted/30 border-none ring-1 ring-border shadow-none">
                  <SelectValue placeholder="Select related campaign" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-none shadow-2xl p-2 max-h-[200px]">
                  <SelectItem value="none" className="rounded-xl font-bold text-muted-foreground">None</SelectItem>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id} className="rounded-xl">
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Budget Type *</Label>
                <Select
                  value={formData.budget_type}
                  onValueChange={(v) => setFormData({ ...formData, budget_type: v as "daily" | "monthly" | "lifetime" })}
                >
                  <SelectTrigger className="h-12 rounded-2xl bg-muted/30 border-none ring-1 ring-border shadow-none">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent className="rounded-2xl border-none shadow-2xl p-2">
                    <SelectItem value="daily" className="rounded-xl">Daily</SelectItem>
                    <SelectItem value="monthly" className="rounded-xl">Monthly</SelectItem>
                    <SelectItem value="lifetime" className="rounded-xl">Lifetime</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="amount" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Amount *</Label>
                <div className="relative">
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="h-12 rounded-2xl bg-muted/30 border-none ring-1 ring-border shadow-none pr-12 focus-visible:ring-primary focus-visible:ring-2 transition-all"
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground">THB</span>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Currency</Label>
              <Select
                value={formData.currency_id}
                onValueChange={(v) => setFormData({ ...formData, currency_id: v })}
              >
                <SelectTrigger className="h-12 rounded-2xl bg-muted/30 border-none ring-1 ring-border shadow-none">
                  <SelectValue placeholder="Select currency" />
                </SelectTrigger>
                <SelectContent className="rounded-2xl border-none shadow-2xl p-2">
                  <SelectItem value="THB" className="rounded-xl">THB (฿)</SelectItem>
                  <SelectItem value="USD" className="rounded-xl">USD ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="start_date" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">Start Date</Label>
                <Input
                  id="start_date"
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="h-12 rounded-2xl bg-muted/30 border-none ring-1 ring-border shadow-none focus-visible:ring-primary transition-all"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_date" className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1">End Date</Label>
                <Input
                  id="end_date"
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="h-12 rounded-2xl bg-muted/30 border-none ring-1 ring-border shadow-none focus-visible:ring-primary transition-all"
                />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border/50">
              <div className="flex justify-between items-center px-1">
                <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Alert Threshold ({formData.alert_threshold_percent}%)</Label>
                <span className="text-[10px] font-bold text-primary bg-primary/10 px-2 py-1 rounded-full">
                  Alert at {formData.alert_threshold_percent}%
                </span>
              </div>
              <Slider
                value={[formData.alert_threshold_percent]}
                onValueChange={(v) => setFormData({ ...formData, alert_threshold_percent: v[0] })}
                max={100}
                min={1}
                step={1}
                className="py-2"
              />
              <p className="text-[9px] text-muted-foreground leading-relaxed italic">
                * You will be notified when spending reaches the threshold you set
              </p>
            </div>
          </div>
        </form>

        <DialogFooter className="p-8 pt-4 gap-3 sm:gap-2 bg-background border-t">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="rounded-2xl h-12 flex-1 font-bold hover:bg-muted transition-colors"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={(e) => handleSubmit(e)}
            className="rounded-2xl h-12 flex-1 font-black uppercase tracking-wider bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            Create Budget
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
