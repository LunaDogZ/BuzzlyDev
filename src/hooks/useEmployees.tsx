import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { toast } from "sonner";
import { auditSecurity } from "@/lib/auditLogger";

export interface Employee {
  id: string;
  email: string;
  user_id: string | null;
  role_employees_id: string | null;
  status: string | null;
  approval_status: string | null;
  is_locked: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  // Profile data (from employees_profile table)
  profile?: {
    id?: string;
    first_name: string | null;
    last_name: string | null;
    profile_img: string | null;
    aptitude: string | null;
    last_active: string | null;
  };
  // Role data (from role_employees table - uses role_name, not name)
  role?: {
    id?: string;
    role_name: string | null;
    description: string | null;
  };
}

export interface EmployeeInsert {
  email: string;
  first_name?: string;
  last_name?: string;
  role_employees_id?: string;
  aptitude?: string;
}

export function useEmployees() {
  const queryClient = useQueryClient();

  const { data: employees = [], isLoading, error } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => {
      // Bug #L2-4 FIX: Use Supabase joins instead of N+1 pattern
      // This ensures role data is always fresh, even after approval triggers update role_employees_id

      const { data: employeesData, error: employeesError } = await supabase
        .from("employees")
        .select(`
          *,
          profile:employees_profile(*),
          role:role_employees(*)
        `)
        .order("created_at", { ascending: false });

      if (employeesError) throw employeesError;

      return (employeesData || []).map(emp => {
        // Handle profile - Supabase might return it as array or object
        const profileData = Array.isArray(emp.profile) ? emp.profile[0] : emp.profile;
        // Handle role - Supabase might return it as array or object
        const roleData = Array.isArray(emp.role) ? emp.role[0] : emp.role;

        return {
          id: emp.id,
          email: emp.email,
          user_id: emp.user_id,
          role_employees_id: emp.role_employees_id,
          status: emp.status,
          approval_status: emp.approval_status,
          is_locked: emp.is_locked,
          created_at: emp.created_at,
          updated_at: emp.updated_at,
          profile: profileData ? {
            id: profileData.id,
            first_name: profileData.first_name,
            last_name: profileData.last_name,
            profile_img: profileData.profile_img,
            aptitude: profileData.aptitude,
            last_active: profileData.last_active,
          } : undefined,
          role: roleData ? {
            id: roleData.id,
            role_name: roleData.role_name,
            description: roleData.description,
          } : undefined,
        };
      }) as Employee[];
    },
  });

  const { data: roles = [] } = useQuery({
    queryKey: ["employee-roles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("role_employees")
        .select("*")
        .order("role_name");  // Bug #L2-1 Fix: Use correct column name

      if (error) throw error;
      return data || [];
    },
  });

  const createEmployee = useMutation({
    mutationFn: async (newEmployee: EmployeeInsert) => {
      // Create employee record
      const { data: employee, error: empError } = await supabase
        .from("employees")
        .insert({
          email: newEmployee.email,
          role_employees_id: newEmployee.role_employees_id,
          status: "inactive",
          approval_status: "approved",

        })
        .select()
        .single();

      if (empError) throw empError;

      // Create employee profile
      const { error: profileError } = await supabase
        .from("employees_profile")
        .insert({
          employees_id: employee.id,
          first_name: newEmployee.first_name,
          last_name: newEmployee.last_name,
          aptitude: newEmployee.aptitude,
          role_employees_id: newEmployee.role_employees_id,
        });

      if (profileError) {
        // Bug #L2-3 Fix: Rollback employee creation if profile fails
        await supabase.from("employees").delete().eq("id", employee.id);
        throw profileError;
      }

      return employee;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("เพิ่มพนักงานสำเร็จ");

      // Log employee creation
      const { data: { user } } = await getCurrentUser();
      if (user && data) {
        await auditSecurity.employeeApproved(user.id, data.id, data.email);
      }
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถเพิ่มพนักงาน: ${error.message}`);
    },
  });

  const updateEmployee = useMutation({
    mutationFn: async ({
      id,
      profileId,
      updates
    }: {
      id: string;
      profileId?: string;
      updates: Partial<EmployeeInsert> & { status?: string; is_locked?: boolean }
    }) => {
      // Update employee record if needed
      if (updates.role_employees_id || updates.status !== undefined || updates.is_locked !== undefined) {
        const { error: empError } = await supabase
          .from("employees")
          .update({
            role_employees_id: updates.role_employees_id,
            status: updates.status,
            is_locked: updates.is_locked,
          })
          .eq("id", id);

        if (empError) throw empError;
      }

      // Bug #L2-5 Fix: Handle profile updates with NULL check
      if (updates.first_name || updates.last_name || updates.aptitude) {
        if (profileId) {
          // Update existing profile
          const { error: profileError } = await supabase
            .from("employees_profile")
            .update({
              first_name: updates.first_name,
              last_name: updates.last_name,
              aptitude: updates.aptitude,
              role_employees_id: updates.role_employees_id,
            })
            .eq("id", profileId);

          if (profileError) throw profileError;
        } else {
          // Create new profile if doesn't exist
          const { error: profileError } = await supabase
            .from("employees_profile")
            .insert({
              employees_id: id,
              first_name: updates.first_name,
              last_name: updates.last_name,
              aptitude: updates.aptitude,
              role_employees_id: updates.role_employees_id,
            });

          if (profileError) throw profileError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("อัปเดตข้อมูลพนักงานสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถอัปเดตพนักงาน: ${error.message}`);
    },
  });

  const deleteEmployee = useMutation({
    mutationFn: async (id: string) => {
      // Bug #L2-6 Fix: Handle profile delete error
      const { error: profileError } = await supabase
        .from("employees_profile")
        .delete()
        .eq("employees_id", id);

      if (profileError) {
        console.warn("Failed to delete profile:", profileError);
        // Continue anyway since we're deleting employee
      }

      // Delete employee
      const { error } = await supabase
        .from("employees")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("ลบพนักงานสำเร็จ");

      // Log deletion
      void (async () => {
        const { data: { user } } = await getCurrentUser();
        if (user) {
          await auditSecurity.userSuspended(user.id, 'deleted', 'Employee Deleted');
        }
      })();
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถลบพนักงาน: ${error.message}`);
    },
  });

  const suspendEmployee = useMutation({
    mutationFn: async (id: string) => {
      const { data: employee } = await supabase
        .from("employees")
        .select("email, user_id")
        .eq("id", id)
        .single();

      // Get current admin user ID
      const { data: { user: admin } } = await getCurrentUser();

      const { error } = await supabase
        .from("employees")
        .update({ status: "suspended" })
        .eq("id", id);

      if (error) throw error;

      // Log employee suspension
      if (employee && admin) {
        await auditSecurity.userSuspended(
          admin.id,
          employee.user_id || id,
          employee.email || "Unknown"
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("ระงับพนักงานสำเร็จ");
    },
    onError: (error: Error) => {
      // Bug #L2-2 Fix: Add error handler
      toast.error(`ไม่สามารถระงับพนักงาน: ${error.message}`);
    },
  });

  const reactivateEmployee = useMutation({
    mutationFn: async (id: string) => {
      const { data: employee } = await supabase
        .from("employees")
        .select("email, user_id")
        .eq("id", id)
        .single();

      // Get current admin user ID
      const { data: { user: admin } } = await getCurrentUser();

      const { error } = await supabase
        .from("employees")
        .update({ status: "active" })
        .eq("id", id);

      if (error) throw error;

      // Log employee reactivation
      if (employee && admin) {
        await auditSecurity.userActivated(
          admin.id,
          employee.user_id || id,
          employee.email || "Unknown"
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("เปิดใช้งานพนักงานอีกครั้ง");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถเปิดใช้งานพนักงาน: ${error.message}`);
    },
  });

  const approveEmployee = useMutation({
    mutationFn: async (id: string) => {
      const { data: employee } = await supabase
        .from("employees")
        .select("email, user_id, role_employees(*)")
        .eq("id", id)
        .single();

      // Get current admin user ID
      const { data: { user: admin } } = await getCurrentUser();

      const { error } = await supabase
        .from("employees")
        .update({ approval_status: "approved" })
        .eq("id", id);

      if (error) throw error;

      // Log employee approval
      if (employee && admin) {
        await auditSecurity.employeeApproved(
          admin.id,
          employee.user_id || id,
          employee.email || "Unknown"
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("อนุมัติพนักงานสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถอนุมัติ: ${error.message}`);
    },
  });

  const rejectEmployee = useMutation({
    mutationFn: async (id: string) => {
      const { data: employee } = await supabase
        .from("employees")
        .select("email, user_id, role_employees(*)")
        .eq("id", id)
        .single();

      // Get current admin user ID
      const { data: { user: admin } } = await getCurrentUser();

      const { error } = await supabase
        .from("employees")
        .update({ approval_status: "rejected" })
        .eq("id", id);

      if (error) throw error;

      // Log employee rejection
      if (employee && admin) {
        await auditSecurity.employeeRejected(
          admin.id,
          employee.user_id || id,
          employee.email || "Unknown"
        );
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employees"] });
      toast.success("ปฏิเสธพนักงานสำเร็จ");
    },
    onError: (error: Error) => {
      toast.error(`ไม่สามารถปฏิเสธ: ${error.message}`);
    },
  });

  return {
    employees,
    roles,
    isLoading,
    error,
    createEmployee,
    updateEmployee,
    deleteEmployee,
    suspendEmployee,
    reactivateEmployee,
    approveEmployee,
    rejectEmployee,
  };
}
