import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ErrorLog {
    id: string;
    level: string;
    message: string;
    stack_trace: string | null;
    metadata: Record<string, unknown> | null;
    user_id: string | null;
    user_email?: string;
    user_role?: string;
    created_at: string;
    request_id?: string;
}

const fetchUserMap = async (userIds: string[]) => {
    if (userIds.length === 0) return new Map();

    // 1. Fetch Employees
    const { data: employees } = await supabase
        .from('employees')
        .select('user_id, email, role_employees(role_name)')
        .in('user_id', userIds);

    // 2. Fetch Customers
    const { data: customers } = await supabase
        .from('customer')
        .select('id, email')
        .in('id', userIds);

    const map = new Map();

    employees?.forEach(emp => {
        map.set(emp.user_id, {
            email: emp.email,
            role: emp.role_employees?.role_name || 'Employee'
        });
    });

    customers?.forEach(cust => {
        if (!map.has(cust.id)) {
            map.set(cust.id, {
                email: cust.email,
                role: 'Customer'
            });
        }
    });

    return map;
};

export function useDevErrorLogs(levelFilter: string, page: number = 1, pageSize: number = 10, searchQuery: string = "") {
    return useQuery({
        queryKey: ["dev-error-logs", levelFilter, page, pageSize, searchQuery],
        refetchInterval: 10000,
        placeholderData: keepPreviousData,
        queryFn: async () => {
            const from = (page - 1) * pageSize;
            const to = from + pageSize - 1;

            let query = supabase
                .from("error_logs")
                .select("*", { count: 'exact' });

            if (levelFilter !== "all") {
                query = query.eq("level", levelFilter);
            }

            if (searchQuery) {
                const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(searchQuery);

                if (isUuid) {
                    query = query.or(`request_id.eq.${searchQuery},user_id.eq.${searchQuery}`);
                } else {
                    query = query.ilike('message', `%${searchQuery}%`);
                }
            }

            const { data, error, count } = await query
                .order("created_at", { ascending: false })
                .range(from, to);

            if (error) throw error;

            const logs = data || [];
            const userIds = [...new Set(logs.map(l => l.user_id).filter(Boolean))] as string[];

            let userMap = new Map();
            if (userIds.length > 0) {
                userMap = await fetchUserMap(userIds);
            }

            const enrichedLogs = logs.map(log => {
                const userInfo = log.user_id ? userMap.get(log.user_id) : null;
                return {
                    ...log,
                    user_email: userInfo?.email,
                    user_role: userInfo?.role
                };
            });

            return {
                logs: enrichedLogs as ErrorLog[],
                totalCount: count || 0,
                totalPages: Math.ceil((count || 0) / pageSize)
            };
        },
    });
}

export function useDevLogStats() {
    return useQuery({
        queryKey: ["dev-error-stats"],
        refetchInterval: 30000,
        queryFn: async () => {
            const levels = ["critical", "error", "warning", "info"];
            const promises = levels.map(level =>
                supabase
                    .from("error_logs")
                    .select("*", { count: 'exact', head: true })
                    .eq("level", level)
            );

            const totalPromise = supabase
                .from("error_logs")
                .select("*", { count: 'exact', head: true });

            const results = await Promise.all([...promises, totalPromise]);

            const stats = {
                critical: results[0].count || 0,
                error: results[1].count || 0,
                warning: results[2].count || 0,
                info: results[3].count || 0,
                total: results[4].count || 0
            };

            return stats;
        }
    });
}
