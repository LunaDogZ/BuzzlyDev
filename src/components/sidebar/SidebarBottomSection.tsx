import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Zap, Bell, LogOut, Settings, ChevronUp, Gift, TrendingUp, History, ArrowUp, ArrowDown, ArrowUpRight, Users, AlertTriangle } from "lucide-react";
import { RewardsCenterModal } from "@/components/customer/RewardsCenterModal";
import { MyCouponsModal } from "@/components/customer/MyCouponsModal";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PlanSelectionDialog } from "@/components/PlanSelectionDialog";
import { usePlanAccess, PlanType } from "@/hooks/usePlanAccess";
import { useLoyaltyTier, tierColors, tierIcons } from "@/hooks/useLoyaltyTier";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { FeedbackDialog } from "@/components/feedback/FeedbackDialog";
import { MessageSquarePlus, Ticket } from "lucide-react";
import { auditAuth } from "@/lib/auditLogger";
import { useCustomerCoupons } from "@/hooks/useCustomerCoupons";
import { useTeamManagement } from "@/hooks/useTeamManagement";
import { useReceivedInvitations } from "@/hooks/useReceivedInvitations";
import { useWorkspaceNotifications } from "@/hooks/useWorkspaceNotifications";
import { NotificationCenterDialog } from "@/components/customer/NotificationCenterDialog";
import { useProfileCustomer } from "@/hooks/useProfileCustomer";

interface SidebarBottomSectionProps {
  collapsed?: boolean;
}

interface PointsTransaction {
  id: string;
  points_amount: number;
  transaction_type: string;
  description: string;
  created_at: string;
}

const planInfo: Record<PlanType, { name: string; upgradeText: string; showUpgrade: boolean }> = {
  free: {
    name: "Free",
    upgradeText: "Upgrade to Pro",
    showUpgrade: true,
  },
  pro: {
    name: "Pro",
    upgradeText: "Upgrade to Team",
    showUpgrade: true,
  },
  team: {
    name: "Team",
    upgradeText: "Manage Plan",
    showUpgrade: false,
  },
};

export function SidebarBottomSection({ collapsed = false }: SidebarBottomSectionProps) {
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [upgradeHovered, setUpgradeHovered] = useState(false);
  const [rewardsCenterOpen, setRewardsCenterOpen] = useState(false);
  const [myCouponsOpen, setMyCouponsOpen] = useState(false);
  const [notifCenterOpen, setNotifCenterOpen] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const { currentPlan, loading: planLoading } = usePlanAccess();
  const { userLoyalty, getNextTier, getProgressToNextTier, loading: loyaltyLoading } = useLoyaltyTier();
  const { notifications } = useCustomerCoupons();
  const { receivedInvitations } = useReceivedInvitations();   // count only; the popover loads the rest on open
  const { unreadCount: workspaceUnread } = useWorkspaceNotifications();

  const unreadNotifs = notifications.filter(n => !n.is_read).length;
  const unreadInvites = receivedInvitations.length; // Pending invitations are always "unread" for this purpose
  const unreadCount = unreadNotifs + unreadInvites + workspaceUnread;

  const navigate = useNavigate();

  // Use the shared hook for profile data
  const { data: serverProfile } = useProfileCustomer();

  // Sync server data to local state for display
  useEffect(() => {
    if (serverProfile) {
      if (serverProfile.first_name || serverProfile.last_name) {
        setUserName([serverProfile.first_name, serverProfile.last_name].filter(Boolean).join(' '));
      }
      setAvatarUrl(serverProfile.avatar_url || null);
    }
  }, [serverProfile]);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await getCurrentUser();
      if (user) {
        setUserEmail(user.email || null);

        // If serverProfile hasn't loaded yet, fallback to auth metadata
        if (!userName) {
          setUserName(user.user_metadata?.full_name || null);
        }
      }
    };
    fetchUser();
  }, []);

  const handleLogout = async () => {
    const { data: { user } } = await getCurrentUser();
    if (user) {
      // Log logout before signing out
      await auditAuth.logout(user.id, "Customer", user.email || "unknown");
    }
    await supabase.auth.signOut();
    navigate("/auth");
  };

  const getInitials = () => {
    if (userName) {
      return userName.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
    }
    if (userEmail) {
      return userEmail[0].toUpperCase();
    }
    return "U";
  };

  if (planLoading || loyaltyLoading) return null;

  const plan = planInfo[currentPlan];

  // Get tier info for display
  const tierName = userLoyalty?.tier?.name || "Bronze";
  const tierIcon = tierIcons[tierName] || "🥉";
  const tierColor = tierColors[tierName] || tierColors.Bronze;
  const tier = userLoyalty?.tier;
  const nextTier = getNextTier();
  const progress = getProgressToNextTier();

  // Tier benefits
  const tierBenefits = [
    { label: "Discount", value: `${tier?.discount_percentage || 0}%` },
    { label: "Point Multiplier", value: `${tier?.point_multiplier || 1}x` },
  ];

  // Collapsed state - show avatar with tier badge
  if (collapsed) {
    return (
      <div className="p-2 border-t border-sidebar-border space-y-2">
        {/* Avatar dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="w-full h-10 p-0">
              <Avatar className="h-8 w-8">
                <AvatarImage src={avatarUrl || ""} />
                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{userName || "User"}</span>
                <span className="text-xs text-muted-foreground">{userEmail}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setRewardsCenterOpen(true); }}>
              <Gift className="mr-2 h-4 w-4" />
              Rewards Center
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setPlanDialogOpen(true)}>
              <Zap className="mr-2 h-4 w-4" />
              {plan.upgradeText}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Tier Badge in middle (collapsed = icon only with popover) */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "w-full h-10 p-0 flex items-center justify-center",
                "hover:bg-sidebar-accent"
              )}
            >
              <span className="text-lg">{tierIcon}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="center" className="w-72">
            <TierPopoverContent
              tierName={tierName}
              tierIcon={tierIcon}
              tierColor={tierColor}
              tierBenefits={tierBenefits}
              nextTier={nextTier}
              progress={progress}
              recentTransactions={userLoyalty?.recentTransactions || []}
            />
          </PopoverContent>
        </Popover>

        {/* Notifications (collapsed) — mini popover → full center */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" className="w-full h-10 p-0 relative">
              <Bell className="h-4 w-4 text-muted-foreground" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-2.5 h-2 w-2 rounded-full bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="end" className="w-72 p-0">
            <MiniNotifPopover unreadCount={unreadCount} onViewAll={() => setNotifCenterOpen(true)} />
          </PopoverContent>
        </Popover>

        <PlanSelectionDialog open={planDialogOpen} onOpenChange={setPlanDialogOpen} />
        <RewardsCenterModal open={rewardsCenterOpen} onOpenChange={setRewardsCenterOpen} />
      </div>
    );
  }

  // Expanded state
  return (
    <div className="border-t border-border/60">
      {/* Upgrade Card */}
      <div className="p-3">
        <button
          onClick={() => setPlanDialogOpen(true)}
          className={cn(
            "w-full flex items-center gap-3 rounded-xl p-3 transition-all duration-200 relative overflow-hidden group",
            "bg-gradient-to-br from-primary to-indigo-600 text-primary-foreground",
            "hover:opacity-95 active:scale-[0.98]"
          )}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/20">
            <Zap className="h-4 w-4 fill-current" />
          </div>
          <div className="text-left flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{plan.upgradeText}</p>
            <p className="text-[10px] opacity-80 leading-tight truncate">
              {plan.showUpgrade ? "Unlock more benefits" : "Full access"}
            </p>
          </div>
          <ArrowUpRight className="h-3.5 w-3.5 opacity-70 shrink-0" />
        </button>
      </div>

      {/* Bottom Bar - Avatar + Tier Badge + Notifications */}
      <div className="px-3 pb-3 pt-1 flex items-center justify-between gap-2">
        {/* Avatar with Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 w-9 p-0 rounded-full shrink-0">
              <Avatar className="h-8 w-8">
                <AvatarImage src={avatarUrl || ""} />
                <AvatarFallback className="bg-primary text-primary-foreground text-sm font-medium">
                  {getInitials()}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col">
                <span className="font-medium">{userName || "User"}</span>
                <span className="text-xs text-muted-foreground">{userEmail}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setRewardsCenterOpen(true); }}>
              <Gift className="mr-2 h-4 w-4" />
              Rewards Center
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setMyCouponsOpen(true); }}>
              <Ticket className="mr-2 h-4 w-4" />
              My Coupons
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/settings")}>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLogout} className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Tier Badge in Center - Clickable with Popover */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className={cn(
                "h-7 px-2 gap-1 rounded-full text-xs font-medium shrink-0",
                "hover:bg-muted/50",
                tierColor.bg
              )}
            >
              <span className="text-base">{tierIcon}</span>
              <span className={cn("text-xs font-medium", tierColor.text)}>{tierName}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-80">
            <TierPopoverContent
              tierName={tierName}
              tierIcon={tierIcon}
              tierColor={tierColor}
              tierBenefits={tierBenefits}
              nextTier={nextTier}
              progress={progress}
              recentTransactions={userLoyalty?.recentTransactions || []}
            />
          </PopoverContent>
        </Popover>

        {/* Notifications */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 relative text-muted-foreground hover:text-foreground shrink-0">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </Button>
          </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-72 p-0">
              <MiniNotifPopover unreadCount={unreadCount} onViewAll={() => setNotifCenterOpen(true)} />
            </PopoverContent>
          </Popover>
      </div>

      <PlanSelectionDialog open={planDialogOpen} onOpenChange={setPlanDialogOpen} />
      {/* Full Notification Center */}
      <NotificationCenterDialog open={notifCenterOpen} onOpenChange={setNotifCenterOpen} />
      <RewardsCenterModal open={rewardsCenterOpen} onOpenChange={setRewardsCenterOpen} />
      <MyCouponsModal open={myCouponsOpen} onOpenChange={setMyCouponsOpen} />
    </div>
  );
}

// Tier Popover Content Component
interface TierPopoverContentProps {
  tierName: string;
  tierIcon: string;
  tierColor: { bg: string; text: string };
  tierBenefits: { label: string; value: string }[];
  nextTier: { name: string; min_points: number } | null;
  progress: number;
  recentTransactions: PointsTransaction[];
}

function TierPopoverContent({
  tierName,
  tierIcon,
  tierColor,
  tierBenefits,
  nextTier,
  progress,
  recentTransactions
}: TierPopoverContentProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "flex h-12 w-12 items-center justify-center rounded-xl text-2xl",
          tierColor.bg
        )}>
          {tierIcon}
        </div>
        <div>
          <h4 className="font-semibold text-foreground">{tierName} Member</h4>
          <p className="text-xs text-muted-foreground">Your loyalty status</p>
        </div>
      </div>

      {/* Benefits */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Gift className="h-3.5 w-3.5" />
          <span>Your Benefits</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {tierBenefits.map((benefit) => (
            <div key={benefit.label} className="flex flex-col p-2 rounded-lg bg-muted/50">
              <span className="text-xs text-muted-foreground">{benefit.label}</span>
              <span className="text-sm font-semibold text-foreground">{benefit.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Progress to Next Tier */}
      {nextTier && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5" />
            <span>Progress to {nextTier.name}</span>
          </div>
          <div className="space-y-1">
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{Math.round(progress)}% complete</span>
              <span className="font-medium text-foreground">{nextTier.min_points} pts needed</span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Transactions */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <History className="h-3.5 w-3.5" />
          <span>Recent Activity</span>
        </div>
        {recentTransactions.length > 0 ? (
          <div className="space-y-1.5 max-h-32 overflow-y-auto">
            {recentTransactions.map((tx) => (
              <div key={tx.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-muted/30">
                <div className="flex items-center gap-2">
                  {tx.transaction_type === 'earn'
                    ? <ArrowUp className="h-3 w-3 text-emerald-500" />
                    : <ArrowDown className="h-3 w-3 text-destructive" />}
                  <span className="text-muted-foreground truncate max-w-[140px]">
                    {tx.description || tx.transaction_type}
                  </span>
                </div>
                <span className={cn("font-medium", tx.transaction_type === 'earn' ? "text-emerald-500" : "text-destructive")}>
                  {tx.transaction_type === 'earn' ? '+' : '-'}{tx.points_amount} pts
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-2">No recent activity</p>
        )}
      </div>
    </div>
  );
}

// ── Mini Notification Popover ─────────────────────────────────────────────────
function MiniNotifPopover({ unreadCount, onViewAll }: { unreadCount: number; onViewAll: () => void }) {
  const { notifications, markNotificationRead, collectCoupon, collectedCoupons } = useCustomerCoupons();
  const { receivedInvitations, acceptInvitation, declineInvitation } = useTeamManagement();
  const { notifications: workspaceNotifs, markAsRead: markWorkspaceRead } = useWorkspaceNotifications();
  const navigate = useNavigate();

  const collectedDiscountIds = new Set(collectedCoupons.map((c) => c.discount_id));
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  // Merge recent notifications, invitations, and workspace notifications
  const recent = [
    ...notifications.slice(0, 4).map(n => ({ ...n, itemType: 'notification' as const })),
    ...receivedInvitations.slice(0, 2).map(inv => ({
      id: inv.id,
      title: "Team Invitation",
      message: `${inv.team?.name || 'A team'} invited you`,
      type: "team_invite",
      is_read: false,
      created_at: inv.created_at,
      itemType: 'invitation' as const,
    })),
    ...workspaceNotifs.slice(0, 2).map(wn => ({
      id: wn.id,
      title: wn.title,
      message: wn.body ?? '',
      type: wn.type,
      is_read: wn.is_read,
      created_at: wn.created_at,
      itemType: 'workspace' as const,
      link: wn.link,
    }))
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 5);

  const handleCollect = async (notif: { id: string; related_id: string | null }) => {
    if (!notif.related_id) return;
    setCollectingId(notif.id);
    try {
      await collectCoupon.mutateAsync({ discountId: notif.related_id, notificationId: notif.id });
    } finally {
      setCollectingId(null);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <span className="text-sm font-bold">Notifications</span>
        {unreadCount > 0 && (
          <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full px-2 py-0.5">
            {unreadCount} new
          </span>
        )}
      </div>

      <div className="divide-y divide-border/40">
        {recent.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">No notifications yet</p>
        ) : (
          recent.map((notif) => {
            const isDiscount = notif.itemType === 'notification' && notif.type === "discount";
            const alreadyCollected = isDiscount && notif.related_id ? collectedDiscountIds.has(notif.related_id) : false;

            return (
              <div
                key={notif.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors",
                  !notif.is_read ? "bg-primary/5 hover:bg-primary/8" : "hover:bg-muted/40"
                )}
                onClick={() => {
                  if (notif.itemType === 'notification' && !notif.is_read) {
                    markNotificationRead.mutate(notif.id);
                  }
                  if (notif.itemType === 'workspace') {
                    if (!notif.is_read) markWorkspaceRead.mutate(notif.id);
                    if (notif.link) navigate(notif.link);
                    else onViewAll();
                  }
                }}
              >
                <div className={cn(
                  "h-7 w-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                  isDiscount ? "bg-emerald-500/10" : "bg-primary/10"
                )}>
                  {isDiscount
                    ? <Ticket className="h-3.5 w-3.5 text-emerald-600" />
                    : notif.itemType === 'invitation'
                      ? <Users className="h-3.5 w-3.5 text-primary" />
                      : notif.itemType === 'workspace'
                        ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                        : <Zap className="h-3.5 w-3.5 text-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold truncate">{notif.title}</p>
                    {!notif.is_read && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{notif.message}</p>

                  {notif.itemType === 'invitation' ? (
                    <div className="flex gap-1.5 mt-2">
                      <Button
                        size="sm"
                        className="h-6 text-[10px] font-bold flex-1"
                        onClick={(e) => { e.stopPropagation(); acceptInvitation(notif.id); }}
                        disabled={actioningId === notif.id}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] font-bold flex-1"
                        onClick={(e) => { e.stopPropagation(); declineInvitation(notif.id); }}
                        disabled={actioningId === notif.id}
                      >
                        Decline
                      </Button>
                    </div>
                  ) : (
                    <>
                      {isDiscount && notif.related_id && !alreadyCollected && (
                        <Button
                          size="sm"
                          className="mt-1.5 h-6 text-[11px] font-bold w-full"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCollect({ id: notif.id, related_id: notif.related_id });
                          }}
                          disabled={collectingId === notif.id}
                        >
                          {collectingId === notif.id ? "Collecting..." : "Collect Coupon"}
                        </Button>
                      )}
                      {alreadyCollected && (
                        <p className="text-[10px] text-emerald-600 mt-1 font-medium">✓ Collected</p>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-2 border-t border-border/60 space-y-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-8 text-xs font-semibold text-primary hover:text-primary hover:bg-primary/5"
          onClick={onViewAll}
        >
          View all notifications →
        </Button>
        <FeedbackDialog>
          <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-2">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Share Your Feedback
          </Button>
        </FeedbackDialog>
      </div>
    </div>
  );
}