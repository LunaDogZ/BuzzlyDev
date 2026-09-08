import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useEffect, useState } from "react";

export interface ProfileCustomer {
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    phone_number: string | null;
    birthday_at: string | null;
    gender: string | null;
    avatar_url: string | null;
}

export const PROFILE_CUSTOMER_QUERY_KEY = ["profile_customer"];

/**
 * Shared hook for the current user's profile_customers row.
 * Used by Settings page AND SidebarBottomSection so avatar/name
 * stay in sync automatically via React Query cache.
 */
export function useProfileCustomer() {
    const [userId, setUserId] = useState<string | null>(null);
    const queryClient = useQueryClient();

    useEffect(() => {
        getCurrentUser().then(({ data: { user } }) => {
            if (user) setUserId(user.id);
        });
    }, []);

    const query = useQuery({
        queryKey: PROFILE_CUSTOMER_QUERY_KEY,
        queryFn: async () => {
            const { data, error } = await supabase
                .from("profile_customers")
                .select("user_id, first_name, last_name, phone_number, birthday_at, gender, avatar_url")
                .eq("user_id", userId!)
                .single();

            if (error && error.code !== "PGRST116") throw error;
            return (data as ProfileCustomer) ?? null;
        },
        enabled: !!userId,
        staleTime: 30_000,
    });

    const invalidate = () =>
        queryClient.invalidateQueries({ queryKey: PROFILE_CUSTOMER_QUERY_KEY });

    return { ...query, invalidate, userId };
}
