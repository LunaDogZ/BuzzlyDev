import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuItem,
    SidebarFooter,
} from "@/components/ui/sidebar";
import {
    Building2,
    Award,
    Gift,
    PackageOpen,
    LogOut,
    ChevronRight,
    HeadphonesIcon,
    Tag,
    ListChecks,
    Ticket,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { auditAuth } from "@/lib/auditLogger";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationPanel } from "@/components/shared/NotificationPanel";

const supportNavItems = [
    {
        title: "Workspaces",
        icon: Building2,
        href: "/support/workspaces",
    },
    {
        title: "Tier Management",
        icon: Award,
        href: "/support/tier-management",
    },
    {
        title: "Loyalty Reward",
        icon: ListChecks,
        href: "/support/activity-codes",
    },
    {
        title: "Rewards Catalog",
        icon: PackageOpen,
        href: "/support/rewards-management",
    },
    {
        title: "Redemption Requests",
        icon: Ticket,
        href: "/support/redemption-requests",
    },
    {
        title: "Discount Management",
        icon: Tag,
        href: "/support/discount-management",
    },
];

export function SupportSidebar() {
    const navigate = useNavigate();
    const location = useLocation();
    const { toast } = useToast();
    const [userEmail, setUserEmail] = useState<string | null>(null);
    const { notifications, unreadCount, isMarkingAll, markAsRead, markAllAsRead } = useNotifications("support");

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
            const { data: { user } } = await getCurrentUser();
            if (user) {
                await auditAuth.logout(user.id, "Support", user.email || "unknown");
            }
            await supabase.auth.signOut({ scope: 'local' });
            toast({
                title: "Signed Out",
                description: "Support session closed.",
            });
            window.location.href = "/";
        } catch {
            // Ignore errors
        }
    };

    return (
        <Sidebar
            collapsible="none"
            className="border-r border-slate-100 bg-white transition-all duration-300 select-none"
        >
            <SidebarContent className="bg-white">
                {/* Branding Area */}
                <div className="flex items-center gap-3 px-8 py-10 shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-700 text-white shadow-xl">
                        <HeadphonesIcon className="h-6 w-6" />
                    </div>
                    <div>
                        <h2 className="font-bold text-xl tracking-tight text-slate-900 leading-none">Buzzly</h2>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1 block">Support Console</span>
                    </div>
                </div>

                <SidebarGroup className="px-6 py-4">
                    <SidebarGroupContent>
                        <SidebarMenu className="space-y-2">
                            {supportNavItems.map((item, index) => (
                                <SidebarMenuItem
                                    key={item.href}
                                    className={cn(
                                        "animate-slide-in-left",
                                        index === 0 && "stagger-1",
                                        index === 1 && "stagger-2",
                                        index === 2 && "stagger-3",
                                        index === 3 && "stagger-4",
                                        index === 4 && "stagger-5",
                                    )}
                                >
                                    <NavLink
                                        to={item.href}
                                        className={({ isActive }) => cn(
                                            "group flex items-center justify-between px-5 py-4 rounded-[1.25rem] transition-all duration-200 border border-transparent w-full outline-none active:scale-[0.97]",
                                            isActive
                                                ? "bg-emerald-700 text-white shadow-[0_12px_24px_rgba(4,120,87,0.18)] border-emerald-800"
                                                : "text-slate-700 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-100 hover:shadow-sm"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={cn(
                                                "flex h-8 w-8 items-center justify-center rounded-xl transition-all duration-200",
                                                location.pathname === item.href
                                                    ? "bg-white/15 scale-105"
                                                    : "bg-slate-100 group-hover:bg-white group-hover:shadow-sm group-hover:scale-105"
                                            )}>
                                                <item.icon className={cn(
                                                    "h-4 w-4 transition-colors duration-200",
                                                    location.pathname === item.href ? "text-white" : "text-slate-600 group-hover:text-slate-900"
                                                )} />
                                            </div>
                                            <span className="font-semibold tracking-tight text-sm">{item.title}</span>
                                        </div>
                                        <ChevronRight className={cn(
                                            "h-4 w-4 transition-all duration-200",
                                            location.pathname === item.href
                                                ? "opacity-100 translate-x-0.5"
                                                : "opacity-30 group-hover:opacity-80 group-hover:translate-x-0.5"
                                        )} />
                                    </NavLink>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="sticky bottom-0 mt-auto p-5 bg-white border-t border-slate-100 shrink-0">
                <div className="flex items-center justify-between px-2 py-3">
                    {/* Avatar */}
                    <Avatar className="h-10 w-10 border-2 border-emerald-500 shadow-sm">
                        <AvatarFallback className="bg-emerald-500 text-white font-bold text-sm">
                            {userEmail?.[0]?.toUpperCase() || "S"}
                        </AvatarFallback>
                    </Avatar>

                    <div className="flex items-center gap-2">
                        {/* Logout Button */}
                        <button
                            className="p-2 text-slate-400 hover:text-red-500 transition-all duration-150 rounded-lg hover:bg-red-50 active:scale-90"
                            onClick={handleLogout}
                            title="Logout"
                        >
                            <LogOut className="h-4 w-4" />
                        </button>

                        {/* Live Notification Bell */}
                        <NotificationPanel
                            notifications={notifications}
                            unreadCount={unreadCount}
                            isMarkingAll={isMarkingAll}
                            onMarkAsRead={markAsRead}
                            onMarkAllAsRead={markAllAsRead}
                            accentColor="bg-emerald-500"
                            badgeColor="bg-emerald-600"
                        />
                    </div>
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
