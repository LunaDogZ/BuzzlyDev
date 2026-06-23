import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export function CustomerProtectedRoute({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isCustomer, setIsCustomer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!checked) {
      checkCustomerAccess();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);

        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
          setChecked(false);
          checkCustomerAccess();
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [checked]);

  const checkCustomerAccess = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        setIsCustomer(false);
        setLoading(false);
        setChecked(true);
        return;
      }

      setSession(session);
      setUser(session.user);

      // Check employees table (ONLY source of truth for employees)
      const { data: employeeData } = await supabase
        .from("employees")
        .select(`
          status,
          approval_status,
          role_employees (
            role_name
          )
        `)
        .eq("user_id", session.user.id)
        .maybeSingle();

      let isEmployeeRole = false;

      if (employeeData && employeeData.status === 'active' && employeeData.approval_status === 'approved') {
        const roleEmployee = employeeData.role_employees;
        const roleName = roleEmployee?.role_name;

        if (["owner", "admin", "support", "dev"].includes(roleName)) {
          isEmployeeRole = true;
        }
      }

      if (isEmployeeRole) {
        // Employee should not access customer pages
        setIsCustomer(false);
      } else {
        // Regular customer (everyone else) - allow access
        setIsCustomer(true);
      }
    } catch (error) {
      console.error("Error checking customer access:", error);
      setIsCustomer(false);
    } finally {
      setLoading(false);
      setChecked(true);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Not logged in - redirect to auth
  if (!user || !session) {
    return <Navigate to="/auth" replace />;
  }

  // Logged in but blocked - must be admin/owner trying to access customer area
  if (!isCustomer) {
    return <Navigate to="/dev/monitor" replace />;
  }

  // Customer access granted
  return <>{children}</>;
}
