import { useState } from "react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Megaphone,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Zap,
  Share2,
  Route,
  TrendingUp,
  Key,
  FileText,
  Lock,
  Sparkles,
  UsersRound,
  ArrowUpRight,
  Tag,
  Mail,
  HeartIcon,
  Brain,
  UploadCloud,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePlanAccess } from "@/hooks/usePlanAccess";
import { useTeamPermissions } from "@/hooks/useTeamPermissions";
import type { TeamPermissions } from "@/hooks/useTeamManagement";
import { Badge } from "@/components/ui/badge";
import { SidebarBottomSection } from "@/components/sidebar/SidebarBottomSection";
import { useSidebarState } from "@/hooks/useSidebarState";
import { useWorkspaceInfo } from "@/hooks/useWorkspaceInfo";
import { PlanSelectionDialog } from "@/components/PlanSelectionDialog";

const navGroups: Array<{
  label: string;
  items: Array<{
    title: string;
    url: string;
    icon: React.ElementType;
    requiresPlan: "pro" | "team" | null;
    requiresPermission: keyof TeamPermissions;
  }>;
}> = [
  {
    label: "Main",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard, requiresPlan: null, requiresPermission: "view_dashboard" },
      { title: "Social", url: "/social", icon: Share2, requiresPlan: null, requiresPermission: "view_dashboard" },
      { title: "Customer Personas", url: "/personas", icon: Users, requiresPlan: null, requiresPermission: "view_prospects" },
      { title: "Campaigns", url: "/campaigns", icon: Megaphone, requiresPlan: "pro", requiresPermission: "view_campaigns" },
    ]
  },
  {
    label: "Intelligence",
    items: [
      { title: "Customer Journey", url: "/customer-journey", icon: Route, requiresPlan: "pro", requiresPermission: "view_analytics" },
      { title: "AARRR Funnel", url: "/aarrr-funnel", icon: TrendingUp, requiresPlan: "pro", requiresPermission: "view_analytics" },
      { title: "Analytics", url: "/analytics", icon: BarChart3, requiresPlan: "pro", requiresPermission: "view_analytics" },
    ]
  },
  {
    label: "Organization",
    items: [
      { title: "Team Management", url: "/team", icon: UsersRound, requiresPlan: "team", requiresPermission: "manage_team" },
      { title: "Reports", url: "/reports", icon: FileText, requiresPlan: "pro", requiresPermission: "view_analytics" },
    ]
  },
  {
    label: "System",
    items: [
      { title: "API Keys", url: "/api-keys", icon: Key, requiresPlan: null, requiresPermission: "manage_settings" },
      { title: "Imports", url: "/imports", icon: UploadCloud, requiresPlan: null, requiresPermission: "manage_settings" },
      { title: "Settings", url: "/settings", icon: Settings, requiresPlan: null, requiresPermission: "manage_settings" },
    ]
  }
];

export function AppSidebar() {
  const { collapsed, toggle } = useSidebarState();
  const location = useLocation();
  const { currentPlan } = usePlanAccess();
  const { data: workspaceInfo } = useWorkspaceInfo();
  const { canAccess } = useTeamPermissions();
  const [planDialogOpen, setPlanDialogOpen] = useState(false);

  const hasPlanAccess = (requiresPlan: "pro" | "team" | null) => {
    if (!requiresPlan) return true;
    if (requiresPlan === "pro") return currentPlan === "pro" || currentPlan === "team";
    if (requiresPlan === "team") return currentPlan === "team";
    return true;
  };

  const isItemAccessible = (requiresPlan: "pro" | "team" | null, requiresPermission: keyof TeamPermissions) => {
    return canAccess(requiresPermission) && hasPlanAccess(requiresPlan);
  };

  const isPlanLockedOnly = (requiresPlan: "pro" | "team" | null, requiresPermission: keyof TeamPermissions) => {
    return canAccess(requiresPermission) && !hasPlanAccess(requiresPlan);
  };

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen border-r border-border/60 bg-card/50 backdrop-blur-xl transition-all duration-300 flex flex-col select-none",
        collapsed ? "w-20" : "w-72",
      )}
    >
      {/* 1. BRANDING */}
      <div className={cn("flex items-center shrink-0", collapsed ? "h-16 justify-center px-0" : "h-16 px-5")}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm">
            <Zap className="h-5 w-5 text-primary-foreground fill-current" />
          </div>
          {!collapsed && (
            <span className="text-lg font-bold tracking-tight text-foreground">BUZZLY</span>
          )}
        </div>
      </div>

      {/* 2. WORKSPACE & PLAN INDICATOR */}
      {!collapsed && (
        <div className="px-4 mb-3 shrink-0">
          <div className="p-2.5 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer">
            <div className="flex items-center gap-2.5">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-primary to-indigo-600 flex items-center justify-center text-white text-sm font-bold overflow-hidden shrink-0">
                {workspaceInfo?.logo_url ? (
                  <img src={workspaceInfo.logo_url} alt="Logo" className="h-full w-full object-cover" />
                ) : (
                  <span>{workspaceInfo?.name?.charAt(0).toUpperCase() || "B"}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">{workspaceInfo?.name || "Workspace"}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className={cn("h-1.5 w-1.5 rounded-full shrink-0", currentPlan === "free" ? "bg-muted-foreground/60" : "bg-emerald-500")} />
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{currentPlan} Plan</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. SCROLLABLE NAVIGATION */}
      <nav className="flex-1 px-4 space-y-6 overflow-y-auto overflow-x-hidden py-2 min-h-0 no-scrollbar">
        {navGroups.map((group) => (
          <div key={group.label} className="space-y-1">
            {!collapsed && (
              <h4 className="px-3 mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </h4>
            )}
            <div className="space-y-0.5">
              {group.items.filter((item) => canAccess(item.requiresPermission)).map((item) => {
                const accessible = isItemAccessible(item.requiresPlan, item.requiresPermission);
                const planLockedOnly = isPlanLockedOnly(item.requiresPlan, item.requiresPermission);
                const isActive =
                  location.pathname === item.url ||
                  location.pathname.startsWith(item.url + "/");

                if (!accessible && planLockedOnly) {
                  // Has permission but plan locked: render a button that opens the plan dialog
                  return (
                    <button
                      key={item.title}
                      onClick={() => setPlanDialogOpen(true)}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium w-full text-left transition-all duration-200",
                        "text-muted-foreground opacity-60 cursor-pointer hover:opacity-80 hover:bg-muted/50",
                        collapsed && "justify-center px-0 h-10 w-10 mx-auto"
                      )}
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/50">
                        <item.icon className="h-4 w-4" />
                      </div>
                      {!collapsed && <span className="flex-1 truncate tracking-tight">{item.title}</span>}
                      {!collapsed && (
                        <div className="bg-muted p-1 rounded-md">
                          <Lock className="h-3 w-3 text-muted-foreground" />
                        </div>
                      )}
                      {collapsed && (
                        <div className="absolute left-16 scale-0 group-hover:scale-100 transition-all origin-left bg-popover text-popover-foreground text-xs font-bold py-2 px-3 rounded-lg shadow-xl border z-50 whitespace-nowrap">
                          {item.title} 🔒
                        </div>
                      )}
                    </button>
                  );
                }

                return (
                  <NavLink
                    key={item.title}
                    to={item.url}
                    className={({ isActive: isLinkActive }) => cn(
                      "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                      isLinkActive
                        ? "bg-muted/60 text-foreground border-l-2 border-l-primary"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                      collapsed && "justify-center px-0 h-10 w-10 mx-auto",
                    )}
                  >
                    <div className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
                      isActive ? "bg-primary/10 text-primary" : "bg-muted/50 group-hover:bg-muted text-muted-foreground group-hover:text-foreground"
                    )}>
                      <item.icon className="h-4 w-4" />
                    </div>

                    {!collapsed && <span className="flex-1 truncate">{item.title}</span>}

                    {/* Tooltip for collapsed state */}
                    {collapsed && (
                      <div className="absolute left-16 scale-0 group-hover:scale-100 transition-all origin-left bg-popover text-popover-foreground text-xs font-bold py-2 px-3 rounded-lg shadow-xl border z-50 whitespace-nowrap">
                        {item.title}
                      </div>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}

      </nav>

      {/* 4. FOOTER SECTION */}
      <div className="mt-auto shrink-0 border-t border-border/60">
        <SidebarBottomSection collapsed={collapsed} />
      </div>

      {/* 5. FLOATING COLLAPSE TOGGLE */}
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        className="absolute -right-3 top-8 h-7 w-7 rounded-lg border border-border/60 bg-background shadow-sm hover:bg-muted hover:border-border z-50"
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </Button>

      {/* 6. PLAN SELECTION DIALOG (opened by locked nav items) — mounted only while
          open, because it calls useSubscription at mount and the sidebar is on
          every page. See the note in SidebarBottomSection. */}
      {planDialogOpen && <PlanSelectionDialog open onOpenChange={setPlanDialogOpen} />}
    </aside>
  );
}