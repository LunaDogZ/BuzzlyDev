import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';

export type PlanType = "free" | "pro" | "team";

export interface PlanFeatures {
  aiInsights: boolean;
  advancedAnalytics: boolean;
  customReports: boolean;
  customerJourney: boolean;
  aaarrFunnel: boolean;
  teamCollaboration: boolean;
  unlimitedPlatforms: boolean;
  prioritySupport: boolean;
  reportHistory: "7d" | "90d" | "unlimited";
  campaigns: boolean;
}

const planFeatures: Record<PlanType, PlanFeatures> = {
  free: {
    aiInsights: false,
    advancedAnalytics: false,
    customReports: false,
    customerJourney: false,
    aaarrFunnel: false,
    teamCollaboration: false,
    unlimitedPlatforms: false,
    prioritySupport: false,
    reportHistory: "7d",
    campaigns: false,
  },
  pro: {
    aiInsights: true,
    advancedAnalytics: true,
    customReports: true,
    customerJourney: true,
    aaarrFunnel: true,
    teamCollaboration: false,
    unlimitedPlatforms: true,
    prioritySupport: true,
    reportHistory: "90d",
    campaigns: true,
  },
  team: {
    aiInsights: true,
    advancedAnalytics: true,
    customReports: true,
    customerJourney: true,
    aaarrFunnel: true,
    teamCollaboration: true,
    unlimitedPlatforms: true,
    prioritySupport: true,
    reportHistory: "unlimited",
    campaigns: true,
  },
};

// Feature to Plan mapping for upgrade suggestions
export const featureRequiredPlan: Record<keyof PlanFeatures, PlanType> = {
  aiInsights: "pro",
  advancedAnalytics: "pro",
  customReports: "pro",
  customerJourney: "pro",
  aaarrFunnel: "pro",
  teamCollaboration: "team",
  unlimitedPlatforms: "pro",
  prioritySupport: "pro",
  reportHistory: "pro",
  campaigns: "pro",
};

// Human-readable feature names
export const featureNames: Record<keyof PlanFeatures, string> = {
  aiInsights: "AI Insights",
  advancedAnalytics: "Advanced Analytics",
  customReports: "Custom Reports",
  customerJourney: "Customer Journey",
  aaarrFunnel: "AARRR Funnel",
  teamCollaboration: "Team Collaboration",
  unlimitedPlatforms: "Unlimited Platforms",
  prioritySupport: "Priority Support",
  reportHistory: "Extended Report History",
  campaigns: "Campaigns & Ads Management",
};

interface PlanContextValue {
  currentPlan: PlanType;
  loading: boolean;
  hasFeature: (feature: keyof PlanFeatures) => boolean;
  getFeatures: () => PlanFeatures;
  canAccessFeature: (feature: keyof PlanFeatures) => boolean;
  getRequiredPlan: (feature: keyof PlanFeatures) => PlanType;
  getFeatureName: (feature: keyof PlanFeatures) => string;
  updatePlan: (newPlan: PlanType) => Promise<boolean>;
  refetch: (silent?: boolean) => Promise<void>;
}

const PlanContext = createContext<PlanContextValue | undefined>(undefined);

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [currentPlan, setCurrentPlan] = useState<PlanType>("free");
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  const fetchUserPlan = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data: { user } } = await getCurrentUser();

      if (!user) {
        setCurrentPlan("free");
        setUserId(null);
        setLoading(false);
        return;
      }

      setUserId(user.id);

      const { data: subscription } = await supabase
        .from('subscriptions')
        .select('*, subscription_plans(slug)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle();

      // ตรวจสอบว่ามีข้อมูล Subscription และมีชื่อ Plan (slug) ติดมาไหม
      if (subscription?.subscription_plans?.slug) {
        // *** แก้ตรงนี้: ให้ใช้ค่าจาก subscription แทน profile ***
        const rawType = subscription.subscription_plans.slug.toLowerCase();

        console.log("Real Plan from Subscription Table:", rawType);

        // Logic การเช็คเหมือนเดิม
        if (rawType.includes("team")) {
          setCurrentPlan("team");
        } else if (rawType.includes("pro")) {
          setCurrentPlan("pro");
        } else {
          setCurrentPlan("free");
        }
      } else {
        console.log("No active subscription found, falling back to Free");
        setCurrentPlan("free");
      }
    } catch (error) {
      console.error("Error fetching user plan:", error);
      setCurrentPlan("free");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUserPlan();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      fetchUserPlan();
    });

    return () => subscription.unsubscribe();
  }, [fetchUserPlan]);

  const hasFeature = useCallback((feature: keyof PlanFeatures): boolean => {
    return planFeatures[currentPlan][feature] as boolean;
  }, [currentPlan]);

  const getFeatures = useCallback((): PlanFeatures => {
    return planFeatures[currentPlan];
  }, [currentPlan]);

  const canAccessFeature = useCallback((feature: keyof PlanFeatures): boolean => {
    return hasFeature(feature);
  }, [hasFeature]);

  const getRequiredPlan = useCallback((feature: keyof PlanFeatures): PlanType => {
    return featureRequiredPlan[feature];
  }, []);

  const getFeatureName = useCallback((feature: keyof PlanFeatures): string => {
    return featureNames[feature];
  }, []);

  const updatePlan = useCallback(async (newPlan: PlanType): Promise<boolean> => {
    if (!userId) return false;

    // Map plan types to UUIDs
    const planIds: Record<PlanType, string> = {
      free: "5b000001-0000-0000-0000-000000000001",
      pro: "5b000002-0000-0000-0000-000000000002",
      team: "5b000003-0000-0000-0000-000000000003"
    };

    const targetPlanId = planIds[newPlan];

    try {
      // 1. Check if subscription exists
      const { data: existingSub } = await supabase
        .from("subscriptions")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      let error;

      if (existingSub) {
        // Update existing subscription
        const { error: updateError } = await supabase
          .from("subscriptions")
          .update({
            plan_id: targetPlanId,
            status: 'active',
            updated_at: new Date().toISOString()
          })
          .eq("user_id", userId);
        error = updateError;
      } else {
        // Create new subscription (fallback)
        const { error: insertError } = await supabase
          .from("subscriptions")
          .insert({
            user_id: userId,
            plan_id: targetPlanId,
            status: 'active',
            // Default workspace/team handling might be needed here, but for now focus on user subscription
          });
        error = insertError;
      }

      if (error) throw error;

      // Update state immediately for reactive UI
      setCurrentPlan(newPlan);
      await fetchUserPlan(true); // Refetch to ensure everything is synced silently
      return true;
    } catch (error) {
      console.error("Error updating plan:", error);
      return false;
    }
  }, [userId, fetchUserPlan]);

  const value: PlanContextValue = {
    currentPlan,
    loading,
    hasFeature,
    getFeatures,
    canAccessFeature,
    getRequiredPlan,
    getFeatureName,
    updatePlan,
    refetch: fetchUserPlan,
  };

  return (
    <PlanContext.Provider value={value}>
      {children}
    </PlanContext.Provider>
  );
}

export function usePlanContext() {
  const context = useContext(PlanContext);
  if (context === undefined) {
    throw new Error("usePlanContext must be used within a PlanProvider");
  }
  return context;
}
