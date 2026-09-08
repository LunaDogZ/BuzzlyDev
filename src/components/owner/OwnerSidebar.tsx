import { NavLink } from "@/components/NavLink";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useToast } from "@/hooks/use-toast";
import {
  BarChart3,
  TrendingUp,
  MessageSquareHeart,
  FileText,
  Crown,
  LogOut,
  Award,
  ChevronRight,
  ChevronLeft,
  LayoutDashboard,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Fragment, useEffect, useState } from "react";

const ownerNavItems = [
  {
    title: "Dashboard",
    icon: LayoutDashboard,
    href: "/owner/dashboard",
    description: "Overview & Key Metrics",
  },
  {
    title: "Business Performance",
    icon: TrendingUp,
    href: "/owner/business-performance",
    description: "Revenue & Growth",
  },
  {
    title: "Product Usage",
    icon: BarChart3,
    href: "/owner/product-usage",
    description: "AARRR Funnel Metrics",
  },
  {
    title: "Customer Tiers",
    icon: Award,
    href: "/owner/customer-tiers",
    description: "Loyalty Analytics",
  },
  {
    title: "User Feedback",
    icon: MessageSquareHeart,
    href: "/owner/user-feedback",
    description: "Sentiment Analysis",
  },
  {
    title: "Executive Report",
    icon: FileText,
    href: "/owner/executive-report",
    description: "PDF Reports & Insights",
  },
];

interface OwnerSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function OwnerSidebar({ collapsed, onToggle }: OwnerSidebarProps) {
  const { toast } = useToast();
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    const fetchUser = async () => {
      const { data: { user } } = await getCurrentUser();
      if (user) {
        setUserEmail(user.email || null);
      }
    };
    fetchUser();
  }, []);

  const handleLogout = async () => {
    try {
      await supabase.auth.signOut({ scope: 'local' });
      toast({
        title: "Signed Out",
        description: "Your session has ended successfully.",
      });
      window.location.href = "/";
    } catch (e) {
      toast({
        title: "Error",
        description: "Failed to sign out.",
        variant: "destructive",
      });
    }
  };

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 h-screen border-r border-slate-100 bg-white flex flex-col font-sans transition-all duration-300 select-none",
          collapsed ? "w-20" : "w-64"
        )}
      >
        {/* Brand Section */}
        <div className={cn(
          "flex items-center shrink-0",
          collapsed ? "justify-center px-0 py-10" : "gap-3 px-8 py-10"
        )}>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl shrink-0">
            <Crown className="h-5 w-5" />
          </div>
          {!collapsed && (
            <div>
              <h2 className="font-bold text-xl tracking-tight text-slate-900 leading-none">Buzzly</h2>
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest mt-1 block">Owner Portal</span>
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className={cn(
          "flex-1 space-y-1.5 overflow-y-auto custom-scrollbar",
          collapsed ? "px-3 py-4" : "p-6"
        )}>
          {!collapsed && (
            <p className="px-3 mb-4 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] opacity-60">Operations</p>
          )}
          <div className={cn("space-y-1.5", collapsed && "flex flex-col items-center gap-1")}>
            {ownerNavItems.map((item) => {
              const linkEl = (
                <NavLink
                  to={item.href}
                  className={({ isActive }) =>
                    cn(
                      "group flex items-center transition-all duration-300 outline-none border border-transparent",
                      collapsed && "relative",
                      collapsed
                        ? "justify-center h-11 w-11 rounded-2xl mx-auto"
                        : "justify-between rounded-2xl px-4 py-4 w-full",
                      isActive
                        ? "bg-slate-900 text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)] border-slate-800"
                        : "text-slate-500 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-100"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <div className={cn(
                        "flex min-w-0",
                        collapsed ? "items-center justify-center" : "items-center gap-3"
                      )}>
                        <div className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all",
                          isActive ? "bg-white/10" : "bg-slate-100 group-hover:bg-white group-hover:shadow-sm"
                        )}>
                          <item.icon
                            className={cn(
                              "h-4 w-4 transition-colors",
                              isActive ? "text-white" : "text-slate-400 group-hover:text-slate-900"
                            )}
                          />
                        </div>
                        {!collapsed && (
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold tracking-tight text-sm truncate">
                              {item.title}
                            </span>
                            {!isActive && (
                              <span className="text-[10px] text-slate-400 font-medium truncate mt-0.5">
                                {item.description}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {!collapsed && (
                        <ChevronRight className={cn(
                          "h-4 w-4 transition-all duration-300 transform shrink-0",
                          isActive ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2 group-hover:opacity-60 group-hover:translate-x-0"
                        )} />
                      )}
                    </>
                  )}
                </NavLink>
              );
              return collapsed ? (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>
                    <div className="flex justify-center">{linkEl}</div>
                  </TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    <p className="font-semibold">{item.title}</p>
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  </TooltipContent>
                </Tooltip>
              ) : (
                <Fragment key={item.href}>{linkEl}</Fragment>
              );
            })}
          </div>
        </nav>

        {/* User Profile Card - Outstaff Style */}
        <div className={cn(
          "mt-auto shrink-0",
          collapsed ? "p-3" : "p-6"
        )}>
          <div className={cn(
            "bg-slate-50 rounded-[2.5rem] border border-slate-100 relative group transition-all hover:shadow-lg",
            collapsed ? "p-3 flex flex-col items-center gap-3" : "p-6"
          )}>
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <Avatar className={cn(
                  "border-4 border-white shadow-md ring-1 ring-slate-100",
                  collapsed ? "h-12 w-12" : "h-16 w-16"
                )}>
                  <AvatarFallback className="bg-primary/10 text-primary font-bold text-xl">
                    {userEmail?.[0].toUpperCase() || "O"}
                  </AvatarFallback>
                </Avatar>
                <div className="absolute -bottom-1 -right-1 h-5 w-5 bg-emerald-500 border-2 border-white rounded-full shadow-sm" />
              </div>

              {!collapsed && (
                <div className="text-center w-full px-2">
                  <p className="font-bold text-slate-900 truncate tracking-tight text-base">Workspace Owner</p>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5 font-medium">{userEmail}</p>
                </div>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "rounded-2xl bg-white border-slate-200 text-slate-700 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all text-xs font-bold group",
                      collapsed ? "h-10 w-10 p-0" : "w-full mt-2 py-6"
                    )}
                    onClick={handleLogout}
                  >
                    <LogOut className={cn(
                      "text-slate-400 group-hover:text-red-500",
                      collapsed ? "h-4 w-4" : "mr-2 h-4 w-4"
                    )} />
                    {!collapsed && "SIGN OUT"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  Sign out
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>

        {/* Collapse/Expand - Small arrow on border */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onToggle}
              className="absolute -right-3 bottom-8 h-7 w-7 rounded-lg border border-slate-200 bg-white shadow-sm hover:bg-slate-50 hover:border-slate-300 text-slate-600 hover:text-slate-900 z-50"
            >
              {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {collapsed ? "ขยายเมนู" : "พับเมนู"}
          </TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  );
}
