import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { logError } from "@/services/errorLogger";

export interface NotificationPreferences {
  email_reports: boolean;
  push_notifications: boolean;
  weekly_digest: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  email_reports: true,
  push_notifications: true,
  weekly_digest: true,
};

export const NOTIFICATION_PREFERENCES_QUERY_KEY = ["notification_preferences"];

export function useNotificationPreferences() {
  const [userId, setUserId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    getCurrentUser().then(({ data: { user } }) => {
      if (user) setUserId(user.id);
    });
  }, []);

  const query = useQuery({
    queryKey: [...NOTIFICATION_PREFERENCES_QUERY_KEY, userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("email_reports, push_notifications, weekly_digest")
        .eq("user_id", userId!)
        .maybeSingle();

      if (error) throw error;
      return data as NotificationPreferences | null;
    },
    enabled: !!userId,
    staleTime: 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: async (prefs: Partial<NotificationPreferences>) => {
      const { data: { user } } = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      const cached = queryClient.getQueryData<NotificationPreferences | null>([...NOTIFICATION_PREFERENCES_QUERY_KEY, user.id]);
      const merged = { ...DEFAULT_PREFERENCES, ...cached, ...prefs };
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          {
            user_id: user.id,
            email_reports: merged.email_reports,
            push_notifications: merged.push_notifications,
            weekly_digest: merged.weekly_digest,
          },
          { onConflict: "user_id" }
        );

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: NOTIFICATION_PREFERENCES_QUERY_KEY });
      toast({ title: "Preferences saved", description: "Your notification settings have been updated." });
    },
    onError: (err) => {
      logError("useNotificationPreferences.updateMutation", err, { component: "useNotificationPreferences" });
      toast({
        variant: "destructive",
        title: "Failed to save",
        description: "Could not update notification preferences. Please try again.",
      });
    },
  });

  const preferences: NotificationPreferences = query.data ?? DEFAULT_PREFERENCES;
  const isLoading = query.isLoading;

  const setEmailReports = (v: boolean) => updateMutation.mutate({ email_reports: v });
  const setPushNotifications = (v: boolean) => updateMutation.mutate({ push_notifications: v });
  const setWeeklyDigest = (v: boolean) => updateMutation.mutate({ weekly_digest: v });

  return {
    preferences,
    isLoading,
    setEmailReports,
    setPushNotifications,
    setWeeklyDigest,
    isUpdating: updateMutation.isPending,
  };
}
