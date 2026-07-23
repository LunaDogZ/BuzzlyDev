import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { MainLayout } from "@/components/layout/MainLayout";
import { DevLayout } from "@/components/dev/DevLayout";
import { OwnerLayout } from "@/components/owner/OwnerLayout";
import { CustomerProtectedRoute } from "@/components/CustomerProtectedRoute";
import { EmployeeProtectedRoute } from "@/components/EmployeeProtectedRoute";
import { PlatformConnectionsProvider } from "@/hooks/usePlatformConnections";
import { SidebarStateProvider } from "@/hooks/useSidebarState";
import { LoyaltyProvider } from "@/hooks/useLoyaltyTier";
import { PlanProvider } from "@/contexts/PlanContext";
import { PlanGate } from "@/components/layout/PlanGate";
import { TeamPermissionsGuard } from "@/components/TeamPermissionsGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { logError } from "@/services/errorLogger";
import { supabase } from "@/integrations/supabase/client";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import SignUp from "./pages/SignUp";
import Dashboard from "./pages/Dashboard";
import Prospects from "./pages/Prospects";
import Campaigns from "./pages/Campaigns";
import CampaignDetail from "./pages/CampaignDetail";
import SocialLayout from "./pages/social/SocialLayout";
import SocialPlanner from "./pages/social/SocialPlanner";
import SocialAnalyticsView from "./pages/social/SocialAnalyticsView";
import SocialInbox from "./pages/social/SocialInbox";
import SocialIntegrations from "./pages/social/SocialIntegrations";
import Email from "./pages/Email";
import Engagement from "./pages/Engagement";
import AIInsights from "./pages/AIInsights";

import CustomerJourney from "./pages/CustomerJourney";
import AARRRFunnel from "./pages/AARRRFunnel";
import APIKeys from "./pages/APIKeys";

import Analytics from "./pages/Analytics";
import Imports from "./pages/Imports";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import MonitorDashboard from "./pages/dev/MonitorDashboard";
import AuditLogs from "./pages/dev/AuditLogs";
import EmployeeManagement from "./pages/dev/EmployeeManagement";
import TierManagement from "./pages/support/TierManagement";
import RewardsManagement from "./pages/support/RewardsManagement";
import RedemptionRequests from "./pages/support/RedemptionRequests";
import DiscountManagement from "./pages/support/DiscountManagement";
import ActivityCodes from "./pages/support/ActivityCodes";
import TeamManagement from "./pages/TeamManagement";
import OwnerDashboard from "./pages/owner/OwnerDashboard";
import OwnerAuditLogs from "./pages/owner/OwnerAuditLogs";
import ProductUsage from "./pages/owner/ProductUsage";
import BusinessPerformance from "./pages/owner/BusinessPerformance";
import UserFeedback from "./pages/owner/UserFeedback";
import ExecutiveReport from "./pages/owner/ExecutiveReport";
import CustomerTiers from "./pages/owner/CustomerTiers";

// Dev pages (renamed from admin)
import DevSupport from "./pages/dev/DevSupport";
import DevWorkspaces from "./pages/dev/DevWorkspaces";

// Employee shared auth
import EmployeeLogin from "./pages/employee/EmployeeLogin";
import EmployeeSignUp from "./pages/employee/EmployeeSignUp";

// Support layout
import { SupportLayout } from "./components/support/SupportLayout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes
      retry: 1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      onError: (error: Error) => {
        // Log all mutation errors
        logError('React Query mutation failed', error, {
          queryType: 'mutation',
        });
      },
    },
  },
});

const App = () => {
  const currentUserId = useRef<string | null>(null);

  // Expose queryClient for global access (safeguard for cross-hook synchronization)
  useEffect(() => {
    (window as unknown as { queryClient: typeof queryClient }).queryClient = queryClient;
  }, []);

  // ── Clear all React Query cache on sign-out or user switch ───────────────
  // React Query's default staleTime (5 min) means cached workspace/metrics
  // data survives the session. Without this, a freshly-registered user sees
  // the previous user's workspace data immediately upon landing on the app.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const newUserId = session?.user?.id ?? null;

        if (event === 'SIGNED_OUT') {
          // Always clear on explicit sign-out
          queryClient.clear();
          currentUserId.current = null;
        } else if (event === 'SIGNED_IN' && newUserId && newUserId !== currentUserId.current) {
          // Different user signed in mid-session — clear previous user's cache
          queryClient.clear();
          currentUserId.current = newUserId;
        } else if (newUserId) {
          currentUserId.current = newUserId;
        }
      }
    );
    return () => subscription.unsubscribe();
  }, []);

  return (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <PlanProvider>
        <PlatformConnectionsProvider>
          <LoyaltyProvider>
            <SidebarStateProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <BrowserRouter>
                <Routes>
                  {/* Public Routes */}
                  <Route path="/" element={<Auth />} />
                  <Route path="/landing" element={<Landing />} />
                  <Route path="/auth" element={<Navigate to="/" replace />} />
                  <Route path="/signup" element={<SignUp />} />

                  {/* Customer Routes */}
                  <Route element={<CustomerProtectedRoute><MainLayout /></CustomerProtectedRoute>}>
                    <Route path="/dashboard" element={<TeamPermissionsGuard permission="view_dashboard"><Dashboard /></TeamPermissionsGuard>} />
                    <Route path="/personas" element={<TeamPermissionsGuard permission="view_prospects"><Prospects /></TeamPermissionsGuard>} />
                    <Route path="/prospects" element={<Navigate to="/personas" replace />} />
                    <Route path="/campaigns" element={<TeamPermissionsGuard permission="view_campaigns"><PlanGate feature="campaigns"><Campaigns /></PlanGate></TeamPermissionsGuard>} />
                    <Route path="/campaigns/:id" element={<TeamPermissionsGuard permission="view_campaigns"><PlanGate feature="campaigns"><CampaignDetail /></PlanGate></TeamPermissionsGuard>} />
                    {/* Legacy /social-analytics → redirect to /social/analytics */}
                    <Route path="/social-analytics" element={<Navigate to="/social/analytics" replace />} />

                    {/* Social nested routes */}
                    <Route path="/social" element={<TeamPermissionsGuard permission="view_dashboard"><SocialLayout /></TeamPermissionsGuard>}>
                      <Route index element={<Navigate to="planner" replace />} />
                      <Route path="planner" element={<SocialPlanner />} />
                      <Route path="analytics" element={<SocialAnalyticsView />} />
                      <Route path="inbox" element={<SocialInbox />} />
                      <Route path="integrations" element={<SocialIntegrations />} />
                    </Route>

                    <Route path="/customer-journey" element={<TeamPermissionsGuard permission="view_analytics"><CustomerJourney /></TeamPermissionsGuard>} />
                    <Route path="/aarrr-funnel" element={<TeamPermissionsGuard permission="view_analytics"><AARRRFunnel /></TeamPermissionsGuard>} />
                    <Route path="/api-keys" element={<TeamPermissionsGuard permission="manage_settings"><APIKeys /></TeamPermissionsGuard>} />
                    <Route path="/imports" element={<TeamPermissionsGuard permission="manage_settings"><Imports /></TeamPermissionsGuard>} />

                    <Route path="/analytics" element={<TeamPermissionsGuard permission="view_analytics"><Analytics /></TeamPermissionsGuard>} />
                    <Route path="/reports" element={<TeamPermissionsGuard permission="view_analytics"><Reports /></TeamPermissionsGuard>} />
                    <Route path="/settings" element={<TeamPermissionsGuard permission="manage_settings"><Settings /></TeamPermissionsGuard>} />
                    <Route path="/team" element={<TeamPermissionsGuard permission="manage_team"><TeamManagement /></TeamPermissionsGuard>} />
                  </Route>

                  {/* Legacy /admin/* routes → redirect to /dev/* */}
                  <Route path="/admin/login" element={<Navigate to="/employee/login" replace />} />
                  <Route path="/admin/signup" element={<Navigate to="/employee/signup" replace />} />
                  <Route path="/admin" element={<Navigate to="/dev/monitor" replace />} />
                  <Route path="/admin/dashboard" element={<Navigate to="/dev/monitor" replace />} />
                  <Route path="/admin/monitor" element={<Navigate to="/dev/monitor" replace />} />
                  <Route path="/admin/audit-logs" element={<Navigate to="/dev/audit-logs" replace />} />
                  <Route path="/admin/workspaces" element={<Navigate to="/support/workspaces" replace />} />
                  <Route path="/admin/employees" element={<Navigate to="/dev/employees" replace />} />
                  <Route path="/admin/support" element={<Navigate to="/dev/support" replace />} />
                  <Route path="/admin/tier-management" element={<Navigate to="/support/tier-management" replace />} />
                  <Route path="/admin/rewards-campaigns" element={<Navigate to="/support/rewards-campaigns" replace />} />
                  <Route path="/admin/rewards-management" element={<Navigate to="/support/rewards-management" replace />} />
                  <Route path="/admin/redemption-requests" element={<Navigate to="/support/redemption-requests" replace />} />

                  {/* Legacy /dev/login → /employee/login */}
                  <Route path="/dev/login" element={<Navigate to="/employee/login" replace />} />
                  <Route path="/dev/signup" element={<Navigate to="/employee/signup" replace />} />

                  {/* Shared Employee Auth Routes */}
                  <Route path="/employee/login" element={<EmployeeLogin />} />
                  <Route path="/employee/signup" element={<EmployeeSignUp />} />

                  {/* Dev Employee Routes — restricted to 4 pages */}
                  <Route element={<EmployeeProtectedRoute allowedRoles={["dev", "owner"]}><DevLayout /></EmployeeProtectedRoute>}>
                    <Route path="/dev" element={<Navigate to="/dev/monitor" replace />} />
                    <Route path="/dev/dashboard" element={<Navigate to="/dev/monitor" replace />} />
                    <Route path="/dev/monitor" element={<MonitorDashboard />} />
                    <Route path="/dev/audit-logs" element={<AuditLogs />} />
                    <Route path="/dev/employees" element={<EmployeeManagement />} />
                    <Route path="/dev/support" element={<DevSupport />} />
                  </Route>

                  {/* Support Employee Routes */}
                  <Route element={<EmployeeProtectedRoute allowedRoles={["support", "owner"]}><SupportLayout /></EmployeeProtectedRoute>}>
                    <Route path="/support" element={<Navigate to="/support/workspaces" replace />} />
                    <Route path="/support/workspaces" element={<DevWorkspaces />} />
                    <Route path="/support/tier-management" element={<TierManagement />} />
                    <Route path="/support/rewards-management" element={<RewardsManagement />} />
                    <Route path="/support/redemption-requests" element={<RedemptionRequests />} />
                    <Route path="/support/discount-management" element={<DiscountManagement />} />
                    <Route path="/support/activity-codes" element={<ActivityCodes />} />
                  </Route>

                  {/* Owner Employee Routes */}
                  <Route element={<EmployeeProtectedRoute allowedRoles={["owner"]}><OwnerLayout /></EmployeeProtectedRoute>}>
                    <Route path="/owner" element={<Navigate to="/owner/dashboard" replace />} />
                    <Route path="/owner/dashboard" element={<OwnerDashboard />} />
                    <Route path="/owner/product-usage" element={<ProductUsage />} />
                    <Route path="/owner/business-performance" element={<BusinessPerformance />} />
                    <Route path="/owner/user-feedback" element={<UserFeedback />} />
                    <Route path="/owner/executive-report" element={<ExecutiveReport />} />
                    <Route path="/owner/customer-tiers" element={<CustomerTiers />} />
                    <Route path="/settings/audit-logs" element={<OwnerAuditLogs />} />
                  </Route>

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </BrowserRouter>
            </TooltipProvider>
            </SidebarStateProvider>
          </LoyaltyProvider>
        </PlatformConnectionsProvider>
      </PlanProvider>
    </QueryClientProvider>
  </ErrorBoundary>
  );
};

export default App;
