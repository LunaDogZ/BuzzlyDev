import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarFooter,
} from "@/components/ui/sidebar";
import {
    Activity,
    ClipboardList,
    ShieldCheck,
    Building2,
    Award,
    Gift,
    PackageOpen,
    UserCog,
    LogOut,
    ChevronRight,
    HeadphonesIcon,
    Bell,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { auditAuth } from "@/lib/auditLogger";

const adminNavItems = [
    {
        title: "Monitor Dashboard",
        icon: Activity,
        href: "/admin/monitor",
    },
    {
        title: "Audit Logs",
        icon: ClipboardList,
        href: "/admin/audit-logs",
    },
    {
        title: "Workspaces",
        icon: Building2,
        href: "/admin/workspaces",
    },
    {
        title: "Employee Management",
        icon: UserCog,
        href: "/admin/employees",
    },
    {
        title: "Support Tickets",
        icon: HeadphonesIcon,
        href: "/admin/support",
    },
    {
        title: "Tier Management",
        icon: Award,
        href: "/admin/tier-management",
    },
    {
        title: "Rewards Catalog",
        icon: PackageOpen,
        href: "/admin/rewards-management",
    },
    {
        title: "Redemption Requests",
        icon: ClipboardList,
        href: "/admin/redemption-requests",
    },
];

export function AdminSidebar() {
    const navigate = useNavigate();
    const location = useLocation();
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
            const { data: { user } } = await getCurrentUser();
            if (user) {
                // Log logout before signing out
                await auditAuth.logout(user.id, "Admin", user.email || "unknown");
            }
            await supabase.auth.signOut({ scope: 'local' });
            toast({
                title: "Signed Out",
                description: "Admin session closed.",
            });
            window.location.href = "/";
        } catch {
            // Ignore errors
        }
    };

    return (
        <Sidebar
            collapsible="none"
            className="border-r border-slate-800 bg-[#0B0F1A] transition-all duration-300 select-none shadow-xl"
        >
            <SidebarContent className="bg-[#0B0F1A]">
                {/* Branding Area */}
                <div className="flex items-center gap-3 px-8 py-10 shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-xl">
                        <ShieldCheck className="h-6 w-6" />
                    </div>
                    <div>
                        <h2 className="font-bold text-xl tracking-tight text-white leading-none">Buzzly</h2>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1 block">Systems Admin</span>
                    </div>
                </div>


                <SidebarGroup className="px-6 py-4">
                    <SidebarGroupContent>
                        <SidebarMenu className="space-y-2">
                            {adminNavItems.map((item) => (
                                <SidebarMenuItem key={item.href}>
                                    <NavLink
                                        to={item.href}
                                        className={({ isActive }) => cn(
                                            "group flex items-center justify-between px-5 py-4 rounded-[1.25rem] transition-all duration-300 border border-transparent w-full outline-none",
                                            isActive
                                                ? "bg-blue-600/10 text-blue-400 shadow-[0_0_20px_rgba(37,99,235,0.1)] border-blue-500/20 w-full"
                                                : "text-slate-400 hover:bg-white/5 hover:text-white hover:border-white/5"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className={cn(
                                                "flex h-8 w-8 items-center justify-center rounded-xl transition-all",
                                                location.pathname === item.href ? "bg-white/10" : "bg-white/5 group-hover:bg-white/10 group-hover:shadow-sm"
                                            )}>
                                                <item.icon className={cn(
                                                    "h-4 w-4 transition-colors",
                                                    location.pathname === item.href ? "text-blue-400" : "text-slate-400 group-hover:text-white"
                                                )} />
                                            </div>
                                            <span className="font-semibold tracking-tight text-sm">{item.title}</span>
                                        </div>
                                        <ChevronRight className={cn(
                                            "h-4 w-4 transition-all duration-300",
                                            location.pathname === item.href ? "opacity-100" : "opacity-40 group-hover:opacity-100"
                                        )} />
                                    </NavLink>
                                </SidebarMenuItem>
                            ))}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="sticky bottom-0 mt-auto p-5 bg-[#0B0F1A] border-t border-slate-800 shrink-0">
                <div className="flex items-center justify-between px-2 py-3">
                    {/* Avatar */}
                    <Avatar className="h-10 w-10 border-2 border-blue-500 shadow-sm">
                        <AvatarFallback className="bg-blue-500 text-white font-bold text-sm">
                            {userEmail?.[0]?.toUpperCase() || "A"}
                        </AvatarFallback>
                    </Avatar>

                    <div className="flex items-center gap-2">
                        {/* Logout Button */}
                        <button
                            className="p-2 text-slate-500 hover:text-red-400 transition-colors rounded-lg hover:bg-red-500/10"
                            onClick={handleLogout}
                            title="Logout"
                        >
                            <LogOut className="h-4 w-4" />
                        </button>

                        {/* Bell Notification */}
                        <button className="relative p-2 text-slate-500 hover:text-slate-200 transition-colors rounded-lg hover:bg-white/5">
                            <Bell className="h-5 w-5" />
                            <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 bg-blue-500 rounded-full border-2 border-[#0B0F1A]" />
                        </button>
                    </div>
                </div>
            </SidebarFooter>
        </Sidebar >
    );
}
