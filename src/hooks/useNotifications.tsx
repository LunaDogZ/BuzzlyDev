import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NotificationType =
    | "critical_error"
    | "error_log"
    | "auth_failure"
    | "redemption_request"
    | "suspicious_activity"
    | "discount_exhausted";

export interface Notification {
    id: string;
    target_role: string;
    type: NotificationType;
    title: string;
    body: string | null;
    link: string | null;
    is_read: boolean;
    is_archived: boolean;
    deleted_at: string | null;
    source_id: string | null;
    created_at: string;
}

export type NotificationFilter = "active" | "unread" | "read" | "trash" | "all";

export function useNotifications(role: "dev" | "support" | "owner", filter: NotificationFilter = "active") {
    const queryClient = useQueryClient();

    const BASE_KEY = ["notifications", role];
    const UNREAD_COUNT_KEY = ["notifications", role, "unreadCount"];

    // Fetch notifications for this role with status filtering
    const { data: notifications = [], isLoading } = useQuery({
        queryKey: [...BASE_KEY, filter],
        queryFn: async () => {
            let query = supabase
                .from("notifications")
                .select("*")
                .or(`target_role.eq.${role},target_role.eq.all`);

            if (filter === "active") {
                query = query.is("deleted_at", null);
            } else if (filter === "unread") {
                query = query.is("deleted_at", null).eq("is_read", false);
            } else if (filter === "read") {
                query = query.is("deleted_at", null).eq("is_read", true);
            } else if (filter === "trash") {
                query = query.not("deleted_at", "is", null);
            } else if (filter === "all") {
                query = query.is("deleted_at", null);
            }

            const { data, error } = await query
                .order("created_at", { ascending: false })
                .limit(100);

            if (error) throw error;
            return (data ?? []) as Notification[];
        },
        refetchInterval: 30_000, // fallback polling every 30s
    });

    // Realtime subscription — push new notifications instantly
    useEffect(() => {
        // Use a stable channel name for the role to avoid multiple subscriptions
        const channelId = `notifications-live-${role}`;
        
        const channel = supabase
            .channel(channelId)
            .on(
                "postgres_changes",
                {
                    event: "*",
                    schema: "public",
                    table: "notifications",
                },
                (payload) => {
                    const newNotify = payload.new as { target_role?: string } | null;
                    const oldNotify = payload.old as { target_role?: string } | null;
                    
                    // Logic check: does this change affect the current role?
                    const isRelevant = 
                        (newNotify && (newNotify.target_role === role || newNotify.target_role === "all")) ||
                        (oldNotify && (oldNotify.target_role === role || oldNotify.target_role === "all"));

                    if (isRelevant) {
                        // Aggressively refetch all notification related queries
                        queryClient.refetchQueries({ queryKey: ["notifications", role] });
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [role, queryClient]);

    // Mark single notification as read
    const markAsRead = useMutation({
        mutationFn: async (id: string) => {
            const { error } = await supabase
                .from("notifications")
                .update({ is_read: true })
                .eq("id", id);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: BASE_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
        },
    });

    // Mark all notifications as read
    const markAllAsRead = useMutation({
        mutationFn: async () => {
            const { error } = await supabase
                .from("notifications")
                .update({ is_read: true })
                .or(`target_role.eq.${role},target_role.eq.all`)
                .eq("is_read", false);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: BASE_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
        },
    });

    // Fetch exact unread count from database (excluding archived and deleted)
    const { data: dbUnreadCount = 0 } = useQuery({
        queryKey: UNREAD_COUNT_KEY,
        queryFn: async () => {
            const { count, error } = await supabase
                .from("notifications")
                .select("*", { count: "exact", head: true })
                .or(`target_role.eq.${role},target_role.eq.all`)
                .eq("is_read", false)
                .is("deleted_at", null);
            if (error) throw error;
            return count ?? 0;
        },
        refetchInterval: 30_000,
    });

    const archiveNotifications = useMutation({
        mutationFn: async (ids: string[]) => {
            const { error } = await supabase
                .from("notifications")
                .update({ is_archived: true })
                .in("id", ids);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: BASE_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
        },
    });

    const deleteNotifications = useMutation({
        mutationFn: async (ids: string[]) => {
            const { error } = await supabase
                .from("notifications")
                .update({ deleted_at: new Date().toISOString() })
                .in("id", ids);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: BASE_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
        },
    });

    const restoreNotifications = useMutation({
        mutationFn: async (ids: string[]) => {
            const { error } = await supabase
                .from("notifications")
                .update({ deleted_at: null, is_archived: false })
                .in("id", ids);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: BASE_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
        },
    });

    const permanentlyDeleteNotifications = useMutation({
        mutationFn: async (ids: string[]) => {
            const { error } = await supabase
                .from("notifications")
                .delete()
                .in("id", ids);
            if (error) throw error;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: BASE_KEY });
            queryClient.invalidateQueries({ queryKey: UNREAD_COUNT_KEY });
        },
    });

    const localUnreadCount = notifications.filter((n) => !n.is_read).length;
    const unreadCount = Math.max(dbUnreadCount, localUnreadCount);

    return {
        notifications,
        unreadCount,
        isLoading,
        markAsRead: markAsRead.mutate,
        markAllAsRead: markAllAsRead.mutate,
        isMarkingAll: markAllAsRead.isPending,
        archiveNotifications: archiveNotifications.mutate,
        deleteNotifications: deleteNotifications.mutate,
        restoreNotifications: restoreNotifications.mutate,
        permanentlyDeleteNotifications: permanentlyDeleteNotifications.mutate,
    };
}
