import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef } from "react";
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
// Support layout (a shell, like the other layouts above — stays eager)
import { SupportLayout } from "./components/support/SupportLayout";

// Eager: the two routes that must paint without a second round trip. `/` is
// where every logged-out visitor lands, and NotFound is the catch-all.
import Auth from "./pages/Auth";
import NotFound from "./pages/NotFound";

// ── Route-level code splitting ───────────────────────────────────────────────
// Every page below becomes its own chunk, fetched the first time its route is
// visited. Before this, all 52 pages were static imports, so one visitor
// downloaded every owner report and support console to look at their dashboard.
//
// Removed here rather than split: `Email`, `Engagement` and `AIInsights` were
// imported but had no <Route> and no reference anywhere else in src/ — 1,089
// lines riding along in the main chunk. The page files are left in place in
// case they are planned work; only the dead imports are gone.
const Landing = lazy(() => import("./pages/Landing"));
const SignUp = lazy(() => import("./pages/SignUp"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Prospects = lazy(() => import("./pages/Prospects"));
const Campaigns = lazy(() => import("./pages/Campaigns"));
const CampaignDetail = lazy(() => import("./pages/CampaignDetail"));
const SocialLayout = lazy(() => import("./pages/social/SocialLayout"));
const SocialPlanner = lazy(() => import("./pages/social/SocialPlanner"));
const SocialAnalyticsView = lazy(() => import("./pages/social/SocialAnalyticsView"));
const SocialInbox = lazy(() => import("./pages/social/SocialInbox"));
const CustomerJourney = lazy(() => import("./pages/CustomerJourney"));
const AARRRFunnel = lazy(() => import("./pages/AARRRFunnel"));
const APIKeys = lazy(() => import("./pages/APIKeys"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Imports = lazy(() => import("./pages/Imports"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
const TeamManagement = lazy(() => import("./pages/TeamManagement"));

// Employee shared auth
const EmployeeLogin = lazy(() => import("./pages/employee/EmployeeLogin"));
const EmployeeSignUp = lazy(() => import("./pages/employee/EmployeeSignUp"));

// Dev pages (renamed from admin)
const MonitorDashboard = lazy(() => import("./pages/dev/MonitorDashboard"));
const AuditLogs = lazy(() => import("./pages/dev/AuditLogs"));
const ImportPipeline = lazy(() => import("./pages/dev/ImportPipeline"));
const EmployeeManagement = lazy(() => import("./pages/dev/EmployeeManagement"));
const DevSupport = lazy(() => import("./pages/dev/DevSupport"));
const DevWorkspaces = lazy(() => import("./pages/dev/DevWorkspaces"));

// Support pages
const TierManagement = lazy(() => import("./pages/support/TierManagement"));
const RewardsManagement = lazy(() => import("./pages/support/RewardsManagement"));
const RedemptionRequests = lazy(() => import("./pages/support/RedemptionRequests"));
const DiscountManagement = lazy(() => import("./pages/support/DiscountManagement"));
const ActivityCodes = lazy(() => import("./pages/support/ActivityCodes"));

// Owner pages
const OwnerDashboard = lazy(() => import("./pages/owner/OwnerDashboard"));
const OwnerAuditLogs = lazy(() => import("./pages/owner/OwnerAuditLogs"));
const ProductUsage = lazy(() => import("./pages/owner/ProductUsage"));
const BusinessPerformance = lazy(() => import("./pages/owner/BusinessPerformance"));
const UserFeedback = lazy(() => import("./pages/owner/UserFeedback"));
const ExecutiveReport = lazy(() => import("./pages/owner/ExecutiveReport"));
const CustomerTiers = lazy(() => import("./pages/owner/CustomerTiers"));

// Matches the spinner CustomerProtectedRoute already shows while it resolves a
// session, so a route change does not swap between two different loading looks.
const RouteFallback = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
  </div>
);

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
                <Suspense fallback={<RouteFallback />}>
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

                  {/* Dev Employee Routes — restricted to 5 pages */}
                  <Route element={<EmployeeProtectedRoute allowedRoles={["dev", "owner"]}><DevLayout /></EmployeeProtectedRoute>}>
                    <Route path="/dev" element={<Navigate to="/dev/monitor" replace />} />
                    <Route path="/dev/dashboard" element={<Navigate to="/dev/monitor" replace />} />
                    <Route path="/dev/monitor" element={<MonitorDashboard />} />
                    <Route path="/dev/audit-logs" element={<AuditLogs />} />
                    <Route path="/dev/imports" element={<ImportPipeline />} />
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
                </Suspense>
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
