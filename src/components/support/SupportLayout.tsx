import { Outlet, useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { logPageView } from "@/lib/auditLogger";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SupportSidebar } from "./SupportSidebar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { useEmployeeAuth } from "@/hooks/useEmployeeAuth";

export function SupportLayout() {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const prevPathRef = useRef<string>("");
    const { toast } = useToast();

    useEffect(() => {
        if (pathname && pathname !== prevPathRef.current) {
            prevPathRef.current = pathname;
            logPageView(pathname);
        }
    }, [pathname]);
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isChecking, setIsChecking] = useState(true);
    useEmployeeAuth(); // Trigger last_active update logic

    useEffect(() => {
        checkSupportAccess();
    }, []);

    const checkSupportAccess = async () => {
        const { data: { user } } = await supabase.auth.getUser();

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

        const roleName = employeeData?.role_employees?.role_name;

        // Allow support and owner
        if (!employeeData || !["support", "owner"].includes(roleName)) {
            const { data: roleData } = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", user.id)
                .in("role", ["support", "owner"])
                .maybeSingle();

            if (!roleData) {
                toast({
                    title: "Access Denied",
                    description: "You don't have support privileges",
                    variant: "destructive",
                });
                navigate("/employee/login");
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

    // Skeleton layout during auth check — matches the real layout shape
    if (isChecking && !isAuthorized) {
        return (
            <div className="flex h-screen overflow-hidden w-full font-sans">
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
                        {[1, 2, 3, 4, 5].map(i => (
                            <Skeleton key={i} className="h-12 w-full rounded-[1.25rem]" />
                        ))}
                    </div>
                </div>
                {/* Main content skeleton */}
                <main className="flex-1 overflow-y-auto px-8 pt-6 pb-10 space-y-6">
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-48" />
                        <Skeleton className="h-4 w-72" />
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        {[1, 2, 3].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}
                    </div>
                    <Skeleton className="h-64 rounded-xl" />
                </main>
            </div>
        );
    }

    return (
        <SidebarProvider>
            <div className="flex h-screen overflow-hidden w-full animate-fade-in font-sans">
                <SupportSidebar />
                <main className="flex-1 overflow-y-auto bg-background px-8 pt-6 pb-10">
                    <Outlet />
                </main>
            </div>
        </SidebarProvider>
    );
}

