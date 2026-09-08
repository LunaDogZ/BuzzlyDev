import { useState, useEffect, type InputHTMLAttributes } from "react";
import { useSearchParams } from "react-router-dom";
import { cn, getErrorMessage } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import {
  User,
  CreditCard,
  Bell,
  DollarSign,
  Building2,
  Crown,
  Camera,
  Trash2,
  AlertTriangle,
  Wallet,
  ShieldCheck,
  CheckCircle2,
  Plus,
  Info,
} from "lucide-react";
import { CreateBudgetDialog } from "@/components/settings/CreateBudgetDialog";
import { BudgetDetailDialog } from "@/components/settings/BudgetDetailDialog";
import { ChangePasswordDialog } from "@/components/settings/ChangePasswordDialog";
import { Progress } from "@/components/ui/progress";

// Import your custom sub-components
import { WorkspaceSettings } from "@/components/settings/WorkspaceSettings";
import { BillingTab } from "@/components/settings/BillingTab";
import { LoyaltyTab } from "@/components/settings/LoyaltyTab";
import { SettingsGeneralTab } from "@/components/settings/SettingsGeneralTab";
import { useUserPaymentMethods } from "@/hooks/useUserPaymentMethods";
import { useBudgets, type Budget } from "@/hooks/useBudgets";
import { useProfileCustomer } from "@/hooks/useProfileCustomer";
import { useNotificationPreferences } from "@/hooks/useNotificationPreferences";

const settingsNavItems = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "billing", label: "Billing plans", icon: CreditCard },
  { id: "login-security", label: "Login & security", icon: ShieldCheck },
  { id: "manage-workspace", label: "Manage Workspace", icon: Building2 },
  // Finance extras (kept for full feature set)
  { id: "payment-methods", label: "Payment Methods", icon: Wallet },
  { id: "budget", label: "Budgeting", icon: DollarSign },
  { id: "loyalty", label: "Loyalty Points", icon: Crown },
];

export default function Settings() {
  const { toast } = useToast();
  const {
    preferences: notificationPrefs,
    isLoading: notificationPrefsLoading,
    isUpdating: notificationPrefsUpdating,
    setEmailReports,
    setPushNotifications,
    setWeeklyDigest,
  } = useNotificationPreferences();

  // Profile data state
  const [profileData, setProfileData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    birthday: "",
    genderId: "",
  });
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Use the shared hook for profile data
  const { data: serverProfile, isLoading: isServerLoading, invalidate } = useProfileCustomer();

  // Sync server data to local form state when it loads
  useEffect(() => {
    if (serverProfile) {
      setProfileData({
        firstName: serverProfile.first_name || "",
        lastName: serverProfile.last_name || "",
        // Form needs email, but profile_customers doesn't store it, 
        // fallback to auth.email if we had it, or keep existing to not wipe it while typing
        email: profileData.email,
        phoneNumber: serverProfile.phone_number || "",
        birthday: serverProfile.birthday_at ? serverProfile.birthday_at.split('T')[0] : "",
        genderId: serverProfile.gender || "",
      });
      setAvatarUrl(serverProfile.avatar_url || null);
    }
  }, [serverProfile]);

  // Fetch user email separately since it's in auth/customer, not profile_customers
  useEffect(() => {
    const fetchEmail = async () => {
      const { data: { user } } = await getCurrentUser();
      if (user) {
        setProfileData(p => ({ ...p, email: user.email || "" }));
      }
    };
    fetchEmail();
  }, []);

  const isLoadingProfile = isServerLoading;

  // Handle profile save
  const handleSaveProfile = async () => {
    try {
      setIsSavingProfile(true);

      const { data: { user } } = await getCurrentUser();
      if (!user) {
        toast({
          title: "Error",
          description: "User not authenticated",
          variant: "destructive",
        });
        return;
      }

      // Upsert profile_customers (creates row if not exist, updates if exist)
      const { error: profileError } = await supabase
        .from('profile_customers')
        .upsert({
          user_id: user.id,
          first_name: profileData.firstName,
          last_name: profileData.lastName,
          phone_number: profileData.phoneNumber,
          birthday_at: profileData.birthday ? new Date(profileData.birthday).toISOString().split('T')[0] : null,
          gender: profileData.genderId || null,
        }, {
          onConflict: 'user_id',
        });

      if (profileError) {
        console.error('Profile update error:', profileError);
        toast({
          title: "Error",
          description: "Failed to update profile: " + profileError.message,
          variant: "destructive",
        });
        return;
      }

      // Update customer table for full_name and phone.
      // Use .update() to avoid accidentally overwriting plan_type or other
      // billing-managed columns (the trigger creates the row on sign-up).
      const { error: customerError } = await supabase
        .from('customer')
        .update({
          full_name: `${profileData.firstName} ${profileData.lastName}`.trim(),
          phone_number: profileData.phoneNumber,
        })
        .eq('id', user.id);

      if (customerError) {
        console.error('Customer update error:', customerError);
        toast({
          title: "Warning",
          description: "Profile saved, but failed to sync display name: " + customerError.message,
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: "Profile updated successfully",
      });
      invalidate(); // Re-fetch to sync with sidebar
    } catch (error) {
      console.error('Error saving profile:', error);
      toast({
        title: "Error",
        description: "Failed to save profile",
        variant: "destructive",
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Handle avatar upload
  const handleUploadAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File exceeds 2MB limit", variant: "destructive" });
      return;
    }
    try {
      setIsUploadingAvatar(true);
      const { data: { user } } = await getCurrentUser();
      if (!user) return;

      const ext = file.name.split('.').pop();
      const path = `${user.id}/avatar.${ext}`;

      // Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(path);

      // Save URL to profile_customers
      await supabase
        .from('profile_customers')
        .upsert({ user_id: user.id, avatar_url: publicUrl }, { onConflict: 'user_id' });

      setAvatarUrl(publicUrl + '?t=' + Date.now()); // bust cache
      toast({ title: "Avatar uploaded successfully" });
      invalidate(); // Re-fetch to sync with sidebar
    } catch (err) {
      toast({ title: "Upload failed", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsUploadingAvatar(false);
      // Reset input so same file can be re-selected
      e.target.value = "";
    }
  };

  // Handle avatar remove
  const handleRemoveAvatar = async () => {
    try {
      setIsUploadingAvatar(true);
      const { data: { user } } = await getCurrentUser();
      if (!user) return;

      // Remove all avatar files for this user
      const { data: files } = await supabase.storage.from('avatars').list(user.id);
      if (files && files.length > 0) {
        await supabase.storage
          .from('avatars')
          .remove(files.map(f => `${user.id}/${f.name}`));
      }

      // Clear avatar_url in DB
      await supabase
        .from('profile_customers')
        .upsert({ user_id: user.id, avatar_url: null }, { onConflict: 'user_id' });

      setAvatarUrl(null);
      toast({ title: "Avatar removed successfully" });
      invalidate(); // Re-fetch to sync with sidebar
    } catch (err) {
      toast({ title: "Failed to remove avatar", description: getErrorMessage(err), variant: "destructive" });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const initialTab =
    tabFromUrl === "workspace" ? "manage-workspace" : tabFromUrl || "profile";
  const [activeTab, setActiveTab] = useState(initialTab);

  useEffect(() => {
    const t = tabFromUrl === "workspace" ? "manage-workspace" : tabFromUrl || "profile";
    setActiveTab(t);
  }, [tabFromUrl]);

  const navigateToPaymentMethods = () => {
    setActiveTab("payment-methods");
    setSearchParams({ tab: "payment-methods" });
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams(value === "profile" ? {} : { tab: value });
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-8 space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col gap-2 border-b border-border/60 pb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Configure your workspace, security, and global preferences.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-8 lg:gap-12">
        {/* Left Sidebar Navigation */}
        <nav className="w-full lg:w-56 shrink-0">
          <ul className="space-y-0.5">
            {settingsNavItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => handleTabChange(item.id)}
                  className={cn(
                    "w-full flex items-center gap-3 pl-4 pr-3 py-2.5 rounded-r-lg text-sm font-medium transition-all text-left border-l-2",
                    activeTab === item.id
                      ? "bg-muted/80 dark:bg-muted/50 text-foreground border-l-primary"
                      : "border-l-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Right Content Area */}
        <div className="flex-1 min-w-0">
          {/* Profile */}
          {activeTab === "profile" && (
            <SettingsGeneralTab />
          )}

          {/* Notifications */}
          {activeTab === "notifications" && (
            <Card className="border-none shadow-sm bg-muted/20 rounded-3xl">
              <CardHeader className="p-8">
                <CardTitle className="text-xl font-bold tracking-tight">Channels & Frequency</CardTitle>
                <CardDescription>Control how and when you receive critical alerts.</CardDescription>
              </CardHeader>
              <CardContent className="p-8 pt-0 space-y-2">
                {notificationPrefsLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-20 w-full rounded-2xl" />
                    <Skeleton className="h-20 w-full rounded-2xl" />
                    <Skeleton className="h-20 w-full rounded-2xl" />
                  </div>
                ) : (
                  <>
                    <NotificationSwitch
                      title="Email Reports"
                      desc="Daily campaign summaries delivered to your inbox."
                      checked={notificationPrefs.email_reports}
                      onCheckedChange={setEmailReports}
                      disabled={notificationPrefsUpdating}
                    />
                    <NotificationSwitch
                      title="Push Notifications"
                      desc="Instant updates in your browser for budget alerts."
                      checked={notificationPrefs.push_notifications}
                      onCheckedChange={setPushNotifications}
                      disabled={notificationPrefsUpdating}
                    />
                    <NotificationSwitch
                      title="Weekly Performance Digest"
                      desc="A deep-dive analysis into your growth metrics."
                      checked={notificationPrefs.weekly_digest}
                      onCheckedChange={setWeeklyDigest}
                      disabled={notificationPrefsUpdating}
                    />
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Billing plans */}
          {activeTab === "billing" && (
            <BillingTab onNavigateToPaymentMethods={navigateToPaymentMethods} />
          )}

          {/* Login & security */}
          {activeTab === "login-security" && (
            <>
              <Card className="border-none shadow-sm bg-muted/20 rounded-3xl">
                <CardHeader className="p-8">
                  <CardTitle className="text-xl font-bold tracking-tight">Login & Security</CardTitle>
                  <CardDescription>Manage your password and security settings.</CardDescription>
                </CardHeader>
                <CardContent className="p-8 pt-0 space-y-4">
                  <div className="flex items-center justify-between p-6 rounded-2xl bg-background border">
                    <div>
                      <p className="font-bold text-sm">Password</p>
                      <p className="text-xs text-muted-foreground">Update your password to keep your account secure.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setChangePasswordOpen(true)}>
                      Change
                    </Button>
                  </div>
                </CardContent>
              </Card>
              <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />
            </>
          )}

          {/* Manage Workspace */}
          {activeTab === "manage-workspace" && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold">Manage Workspace</h2>
              <WorkspaceSettings />
            </div>
          )}

          {/* Payment Methods */}
          {activeTab === "payment-methods" && <PaymentMethodsSection />}

          {/* Budget */}
          {activeTab === "budget" && <BudgetSection onNavigateToPaymentMethods={navigateToPaymentMethods} />}

          {/* Loyalty */}
          {activeTab === "loyalty" && <LoyaltyTab />}
        </div>
      </div>
    </div>
  );
}

// --- SUB-COMPONENTS ---

function SettingInput({ label, id, ...props }: { label: string; id: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-bold uppercase text-muted-foreground ml-1">
        {label}
      </Label>
      <Input
        id={id}
        className="h-12 rounded-xl bg-background border-none shadow-none ring-1 ring-border focus-visible:ring-primary focus-visible:ring-2"
        {...props}
      />
    </div>
  );
}

function NotificationSwitch({
  title,
  desc,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  title: string;
  desc: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between p-6 rounded-2xl bg-background border border-border/50 hover:border-primary/20 transition-all group">
      <div className="space-y-1">
        <p className="font-bold text-sm group-hover:text-primary transition-colors">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}

interface BudgetSectionProps {
  onNavigateToPaymentMethods?: () => void;
}

function BudgetSection({ onNavigateToPaymentMethods }: BudgetSectionProps) {
  const { budgets, isLoading, totalBudget, totalSpent, totalRemaining, alertBudgets, deleteBudget } = useBudgets();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<Budget | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);

  const handleShowDetail = (budget) => {
    setSelectedBudget(budget);
    setIsDetailDialogOpen(true);
  };

  const getSpendPercent = (budget) =>
    budget.amount > 0 ? Math.min((budget.spent_amount / budget.amount) * 100, 100) : 0;

  const isAlert = (budget) =>
    budget.amount > 0 && (budget.spent_amount / budget.amount) * 100 >= budget.alert_threshold_percent;

  return (
    <div className="space-y-6">
      {/* Header — clear title and primary action */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" /> Marketing Treasury
          </h2>
          <p className="text-sm text-muted-foreground mt-1">Track campaign budgets from your database</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {alertBudgets.length > 0 && (
            <Badge variant="outline" className="bg-destructive/5 text-destructive border-destructive/30 gap-1">
              <AlertTriangle className="h-3 w-3" /> {alertBudgets.length} alert{alertBudgets.length > 1 ? "s" : ""}
            </Badge>
          )}
          <Button
            onClick={() => setIsAddDialogOpen(true)}
            className="rounded-xl bg-primary hover:bg-primary/90"
          >
            <Plus className="h-4 w-4 mr-2" /> New Budget
          </Button>
        </div>
      </div>

      {/* Payment Methods info — distinct callout */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-muted/50 border border-border/60">
        <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground min-w-0">
          <span>Budgets are charged to cards in </span>
          {onNavigateToPaymentMethods ? (
            <button
              type="button"
              onClick={onNavigateToPaymentMethods}
              className="text-primary font-medium hover:underline underline-offset-2"
            >
              Payment Methods
            </button>
          ) : (
            <span className="font-medium text-foreground">Payment Methods</span>
          )}
          <span>. When a charge occurs, you can choose which card to use in that tab.</span>
        </div>
      </div>

      {/* Summary Stats — clearer hierarchy */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: "Total Budget", value: totalBudget, color: "text-foreground" },
          { label: "Total Spent", value: totalSpent, color: "text-amber-600 dark:text-amber-500" },
          { label: "Remaining", value: totalRemaining, color: "text-emerald-600 dark:text-emerald-500" },
        ].map((stat) => (
          <div key={stat.label} className="p-5 rounded-xl bg-card border shadow-sm">
            <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
            <p className={`text-2xl font-bold mt-1 ${stat.color}`}>฿{stat.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Budget List Section */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-4">Your Budgets</h3>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
          </div>
        ) : budgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 rounded-xl border-2 border-dashed bg-muted/30">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mb-4">
              <DollarSign className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="font-semibold text-foreground">No budgets yet</p>
            <p className="text-sm text-muted-foreground mt-1 text-center max-w-sm">
              Add budgets via Supabase or API to track campaign spending in real time.
            </p>
            <Button
              variant="outline"
              className="mt-6 rounded-xl"
              onClick={() => setIsAddDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-2" /> Create your first budget
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {budgets.map((budget) => {
              const pct = getSpendPercent(budget);
              const alert = isAlert(budget);
              return (
                <div
                  key={budget.id}
                  onClick={() => handleShowDetail(budget)}
                  className={cn(
                    "p-5 rounded-xl border bg-card transition-all cursor-pointer hover:shadow-sm hover:border-primary/30",
                    alert && "border-destructive/40 bg-destructive/5"
                  )}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                       <p className="font-bold text-sm flex items-center gap-1.5">
                        {budget.name}
                        <Info className="h-3 w-3 text-muted-foreground/50" />
                      </p>
                      {budget.campaign_name && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1.5">{budget.campaign_name}</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 capitalize">{budget.budget_type}</Badge>
                      {alert && (
                        <Badge className="bg-destructive/10 text-destructive border-destructive/20 text-[10px] h-4 px-1.5 gap-1">
                          <AlertTriangle className="h-2.5 w-2.5" /> Alert
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        ฿{budget.spent_amount.toLocaleString()} / ฿{budget.amount.toLocaleString()}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-lg text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation(); // Prevent opening detail dialog
                          deleteBudget.mutate(budget.id);
                        }}
                        disabled={deleteBudget.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <Progress
                    value={pct}
                    className={cn("h-2", alert && "[&>div]:bg-destructive")}
                  />
                  <div className="flex justify-between mt-1">
                    <span className="text-[10px] text-muted-foreground">{pct.toFixed(1)}% used</span>
                    <span className="text-[10px] text-muted-foreground">Alert at {budget.alert_threshold_percent}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <CreateBudgetDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
      />
      <BudgetDetailDialog
        budget={selectedBudget}
        open={isDetailDialogOpen}
        onOpenChange={setIsDetailDialogOpen}
      />
    </div>
  );
}

function PaymentMethodsSection() {
  const { paymentMethods, isLoading, setDefault, removeMethod, addMethod } = useUserPaymentMethods();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const { toast } = useToast();
  const [newCard, setNewCard] = useState({ number: "", expiry: "", cvc: "", name: "" });

  const getCardIcon = (brand: string | null) => {
    if (!brand) return "💳";
    const b = brand.toLowerCase();
    if (b.includes("visa")) return "💳"; // You can replace with an actual SVG if preferred
    if (b.includes("master")) return "💳";
    if (b.includes("amex")) return "💳";
    if (b.includes("jcb")) return "💳";
    if (b.includes("discover")) return "💳";
    if (b.includes("diners")) return "💳";
    return "🏦";
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    let parts = [];

    // AMEX: 4-6-5
    if (/^3[47]/.test(v)) {
      parts.push(v.substring(0, 4));
      if (v.length > 4) parts.push(v.substring(4, 10));
      if (v.length > 10) parts.push(v.substring(10, 15));
    }
    // Diners: 4-6-4
    else if (/^3(?:0[0-5]|[68])/.test(v)) {
      parts.push(v.substring(0, 4));
      if (v.length > 4) parts.push(v.substring(4, 10));
      if (v.length > 10) parts.push(v.substring(10, 14));
    }
    // Default: 4-4-4-4
    else {
      for (let i = 0; i < v.length && i < 16; i += 4) {
        parts.push(v.substring(i, i + 4));
      }
    }

    return parts.join(' ').trim();
  };

  const detectCardBrand = (number: string) => {
    const num = number.replace(/\s+/g, '');
    if (!num) return "unknown";

    if (/^4/.test(num)) return "visa";
    if (/^(5[1-5]|2[2-7])/.test(num)) return "mastercard";
    if (/^3[47]/.test(num)) return "amex";
    if (/^3(?:0[0-5]|[68])/.test(num)) return "diners club";
    if (/^6(?:011|5)/.test(num)) return "discover";
    if (/^(?:2131|1800|35\d{3})/.test(num)) return "jcb";
    if (/^(?:62|81)/.test(num)) return "unionpay";
    if (/^(?:5018|5020|5038|6304|6759|6761|6763)/.test(num)) return "maestro";

    return "unknown";
  };

  const handleAddCard = async () => {
    if (!newCard.number || !newCard.expiry || !newCard.cvc || !newCard.name) {
      toast({
        title: "Incomplete information",
        description: "Please fill in all card details",
        variant: "destructive",
      });
      return;
    }

    // Parse expiry MM/YY
    const [expMonthStr, expYearStr] = newCard.expiry.split('/');
    if (!expMonthStr || !expYearStr || expMonthStr.length !== 2 || expYearStr.length !== 2) {
      toast({
        title: "Invalid expiry format",
        description: "Please use MM/YY format (e.g. 12/26)",
        variant: "destructive",
      });
      return;
    }

    const expMonth = parseInt(expMonthStr, 10);
    const expYear = 2000 + parseInt(expYearStr, 10); // Assume 20xx

    // Determine brand based on number using regex
    const brand = detectCardBrand(newCard.number).toLowerCase();

    try {
      await addMethod.mutateAsync({
        brand,
        last4: newCard.number.replace(/\s+/g, '').slice(-4),
        expMonth,
        expYear,
        name: newCard.name
      });

      toast({
        title: "Card added successfully",
        description: "Your card has been added",
      });

      setIsAddDialogOpen(false);
      setNewCard({ number: "", expiry: "", cvc: "", name: "" });
    } catch (error) {
      // Error handled in hook, but we catch here to stop flow if needed
    }
  };

  return (
    <>
      <Card className="border-none shadow-sm bg-muted/20 rounded-3xl">
        <CardHeader className="p-8 pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold tracking-tight flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" /> Payment Methods
              </CardTitle>
              <CardDescription>
                Saved payment methods for plan renewal and upgrades
              </CardDescription>
            </div>
            <Button onClick={() => setIsAddDialogOpen(true)} className="rounded-xl shadow-sm">
              <CreditCard className="h-4 w-4 mr-2" />
              Add new card
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-8 pt-0 space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-2xl" />
              ))}
            </div>
          ) : paymentMethods.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center rounded-2xl border border-dashed bg-background/50">
              <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <CreditCard className="h-8 w-8 text-muted-foreground" />
              </div>
              <p className="font-bold text-lg">No payment methods yet</p>
              <p className="text-sm text-muted-foreground mt-1 mb-6 max-w-xs mx-auto">
                Add a credit or debit card for convenient payment and automatic renewal
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)} variant="outline" className="rounded-xl">
                Add payment method
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {paymentMethods.map((method) => (
                <div
                  key={method.id}
                  className={cn(
                    "flex items-center justify-between p-5 rounded-2xl border bg-background transition-all hover:shadow-sm",
                    method.is_default && "border-primary/40 bg-primary/5 ring-1 ring-primary/20"
                  )}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/50 text-2xl">
                      {getCardIcon(method.card_brand)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-base">
                          {method.card_brand
                            ? `${method.card_brand} •••• ${method.card_last_four}`
                            : method.bank_name
                              ? `${method.bank_name} •••• ${method.account_last_four}`
                              : method.payment_method?.name ?? "Payment Method"}
                        </p>
                        {method.is_default && (
                          <Badge className="bg-primary/10 text-primary text-[10px] h-5 px-2 rounded-full border-primary/20 shadow-none">
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Default
                          </Badge>
                        )}
                      </div>
                      {method.card_exp_month && method.card_exp_year && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          Expires {String(method.card_exp_month).padStart(2, "0")}/{method.card_exp_year}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!method.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="rounded-xl h-9 text-xs font-medium hover:bg-primary/10 hover:text-primary"
                        onClick={() => setDefault.mutate(method.id)}
                        disabled={setDefault.isPending}
                      >
                        Set Default
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removeMethod.mutate(method.id)}
                      disabled={removeMethod.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-300 rounded-xl text-xs mt-4">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <p>
              Your payment information is securely stored with PCI DSS standards.
              We do not store full card details in our systems.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add credit/debit card</DialogTitle>
            <DialogDescription>
              Add a new card for payments. The card will be stored securely.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name on card</Label>
              <Input
                id="name"
                placeholder="JOHN DOE"
                value={newCard.name}
                onChange={(e) => setNewCard({ ...newCard, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="number">Card number</Label>
              <div className="relative">
                <Input
                  id="number"
                  placeholder="0000 0000 0000 0000"
                  maxLength={19} // 16 digits + 3 spaces
                  value={newCard.number}
                  onChange={(e) => {
                    const formatted = formatCardNumber(e.target.value);
                    setNewCard({ ...newCard, number: formatted });
                  }}
                  className="pl-10 uppercase"
                />
                <div className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground flex items-center justify-center">
                  {newCard.number ? (
                    <span className="text-xs font-bold w-6 text-center">{getCardIcon(detectCardBrand(newCard.number))}</span>
                  ) : (
                    <CreditCard className="h-4 w-4" />
                  )}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="expiry">Expiry date</Label>
                <Input
                  id="expiry"
                  placeholder="MM/YY"
                  value={newCard.expiry}
                  onChange={(e) => setNewCard({ ...newCard, expiry: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="cvc">CVC</Label>
                <Input
                  id="cvc"
                  placeholder="123"
                  maxLength={4}
                  value={newCard.cvc}
                  onChange={(e) => setNewCard({ ...newCard, cvc: e.target.value })}
                />
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setIsAddDialogOpen(false)} disabled={addMethod.isPending}>
              Cancel
            </Button>
            <Button onClick={handleAddCard} disabled={addMethod.isPending}>
              {addMethod.isPending ? "Saving..." : "Save card"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}