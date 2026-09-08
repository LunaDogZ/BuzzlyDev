import { Outlet, useNavigate } from "react-router-dom";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { DevSidebar } from "./DevSidebar";
import { PanelRight } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmployeeAuth } from "@/hooks/useEmployeeAuth";
import { cn } from "@/lib/utils";

function DevLayoutInner() {
    const { state, toggleSidebar } = useSidebar();
    const isCollapsed = state === "collapsed";

    return (
        <div className="dark flex h-screen w-full overflow-hidden animate-fade-in font-sans bg-[#0B0F1A] relative">
            <DevSidebar />
            <main className="flex-1 min-w-0 w-full overflow-y-auto overflow-x-hidden px-6 pt-6 pb-10">
                {isCollapsed && (
                    <button
                        type="button"
                        onClick={toggleSidebar}
                        className="fixed left-4 top-6 z-50 flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-900/95 text-slate-400 shadow-lg backdrop-blur-sm transition-all hover:border-slate-600 hover:bg-slate-800 hover:text-white"
                        title="Open sidebar"
                        aria-label="Open sidebar"
                    >
                        <PanelRight className="h-5 w-5" />
                    </button>
                )}
                <div className={cn("w-full min-w-0", isCollapsed && "pl-14")}>
                    <Outlet />
                </div>
            </main>
        </div>
    );
}

export function DevLayout() {
    const navigate = useNavigate();
    const { toast } = useToast();
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    useEmployeeAuth(); // Trigger last_active update logic

    useEffect(() => {
        checkDevAccess();
    }, []);

    const checkDevAccess = async () => {
        const { data: { user } } = await getCurrentUser();

        if (!user) {
            navigate("/employee/login");
            return;
        }

        const { data: employeeData } = await supabase
            .from("employees")
            .select(`
        status,
        approval_status,
        role_employees (
          role_name
        )
      `)
            .eq("user_id", user.id)
            .maybeSingle();

        if (!employeeData || employeeData.status !== 'active' || employeeData.approval_status !== 'approved') {
            const { data: roleData } = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", user.id)
                .in("role", ["dev", "owner"])
                .maybeSingle();

            if (!roleData) {
                toast({
                    title: "Access Denied",
                    description: "You don't have dev privileges",
                    variant: "destructive",
                });
                navigate("/dashboard");
                return;
            }
        }

        if (employeeData && (employeeData.status !== 'active' || employeeData.approval_status !== 'approved')) {
            toast({
                title: "Access Denied",
                description: "Your account is not active or approved.",
                variant: "destructive",
            });
            navigate("/employee/login");
            return;
        }

        setIsAuthorized(true);
        setIsChecking(false);
    };

    // Skeleton layout during auth check — matches real layout shape
    if (isChecking && !isAuthorized) {
        return (
            <div className="flex min-h-screen w-full font-sans">
                {/* Sidebar skeleton */}
                <div className="w-64 shrink-0 border-r border-slate-100 bg-white flex flex-col">
                    <div className="flex items-center gap-3 px-8 py-10">
                        <Skeleton className="h-10 w-10 rounded-xl" />
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-20" />
                            <Skeleton className="h-2 w-24" />
                        </div>
                    </div>
                    <div className="px-6 space-y-2">
                        {[1, 2, 3, 4].map(i => (
                            <Skeleton key={i} className="h-12 w-full rounded-[1.25rem]" />
                        ))}
                    </div>
                </div>
                {/* Main content skeleton */}
                <main className="flex-1 px-8 pt-6 pb-10 space-y-6">
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-4 w-72" />
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                        {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
                    </div>
                    <Skeleton className="h-64 rounded-xl" />
                </main>
            </div>
        );
    }

    return (
        <SidebarProvider>
            <DevLayoutInner />
        </SidebarProvider>
    );
}

