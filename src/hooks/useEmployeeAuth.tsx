import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";

export type EmployeeRole = "owner" | "admin" | "dev" | "support" | null;

interface EmployeeAuthState {
  user: User | null;
  session: Session | null;
  isEmployee: boolean;
  employeeRole: EmployeeRole;
  employeeId: string | null;
  approvalStatus: string | null;
  loading: boolean;
}

export function useEmployeeAuth() {
  const [state, setState] = useState<EmployeeAuthState>({
    user: null,
    session: null,
    isEmployee: false,
    employeeRole: null,
    employeeId: null,
    approvalStatus: null,
    loading: true,
  });

  useEffect(() => {
    checkEmployeeAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
          setTimeout(() => {
            checkEmployeeAuth();
          }, 0);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const checkEmployeeAuth = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (!session?.user) {
        setState({
          user: null,
          session: null,
          isEmployee: false,
          employeeRole: null,
          employeeId: null,
          approvalStatus: null,
          loading: false,
        });
        return;
      }

      // Check if user is an employee
      const { data: employeeData } = await supabase
        .from("employees")
        .select(`
          id,
          status,
          approval_status,
          role_employees_id,
          role_employees (
            role_name
          )
        `)
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (employeeData && employeeData.status === 'active' && employeeData.approval_status === 'approved') {
        const roleName = employeeData.role_employees?.role_name as EmployeeRole;

        // Update last_active periodically (once per hour to avoid spamming the database)
        const lastUpdateKey = `last_active_update_${employeeData.id}`;
        const lastUpdate = localStorage.getItem(lastUpdateKey);
        const now = Date.now();

        if (!lastUpdate || now - parseInt(lastUpdate, 10) > 1000 * 60 * 60) {
          localStorage.setItem(lastUpdateKey, now.toString());
          supabase
            .from("employees_profile")
            .update({ last_active: new Date().toISOString() })
            .eq("employees_id", employeeData.id)
            .then(({ error }) => {
              if (error) console.error("Error updating last_active:", error);
            });
        }

        setState({
          user: session.user,
          session: session,
          isEmployee: true,
          employeeRole: roleName,
          employeeId: employeeData.id,
          approvalStatus: employeeData.approval_status,
          loading: false,
        });
      } else if (employeeData) {
        // Employee exists but not approved or inactive
        setState({
          user: session.user,
          session: session,
          isEmployee: false,
          employeeRole: null,
          employeeId: employeeData.id,
          approvalStatus: employeeData.approval_status,
          loading: false,
        });
      } else {
        // Not linked yet? Check if there's an unlinked record for this email
        const { data: unlinkedData, error: linkError } = await supabase
          .from("employees")
          .select("id, approval_status, status")
          .eq("email", session.user.email)
          .is("user_id", null)
          .maybeSingle();

        if (unlinkedData) {
          console.log("Found unlinked employee record for", session.user.email, "- linking now...");
          const { error: updateError } = await supabase
            .from("employees")
            .update({ 
               user_id: session.user.id,
               // Auto-activate if it was already approved
               status: unlinkedData.approval_status === 'approved' ? 'active' : unlinkedData.status
            })
            .eq("id", unlinkedData.id);

          if (!updateError) {
            // Ensure profile exists
            const { data: profileExists } = await supabase
              .from("employees_profile")
              .select("id")
              .eq("employees_id", unlinkedData.id)
              .maybeSingle();
              
            if (!profileExists) {
               await supabase.from("employees_profile").insert({
                 employees_id: unlinkedData.id,
                 first_name: session.user.user_metadata?.first_name || '',
                 last_name: session.user.user_metadata?.last_name || '',
                 aptitude: session.user.user_metadata?.aptitude || ''
               });
            }

            // Re-run check to get the full role details
            return checkEmployeeAuth();
          } else {
            console.error("Failed to self-link employee:", updateError);
          }
        }

        // Truly not an employee
        setState({
          user: session.user,
          session: session,
          isEmployee: false,
          employeeRole: null,
          employeeId: null,
          approvalStatus: null,
          loading: false,
        });
      }
    } catch (error) {
      console.error("Error checking employee auth:", error);
      setState(prev => ({
        ...prev,
        isEmployee: false,
        employeeRole: null,
        loading: false,
      }));
    }
  };

  return {
    ...state,
    refetch: checkEmployeeAuth,
  };
}
