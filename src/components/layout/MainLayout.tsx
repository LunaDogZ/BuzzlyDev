import { Outlet, useLocation } from "react-router-dom";
import { useEffect, useRef } from "react";
import { AppSidebar } from "./AppSidebar";
import { Header } from "./Header";
import { useSidebarState } from "@/hooks/useSidebarState";
import { logPageView } from "@/lib/auditLogger";
import { cn } from "@/lib/utils";

export function MainLayout() {
  const { collapsed } = useSidebarState();
  const { pathname } = useLocation();
  const prevPathRef = useRef<string>("");

  useEffect(() => {
    if (pathname && pathname !== prevPathRef.current) {
      prevPathRef.current = pathname;
      logPageView(pathname);
    }
  }, [pathname]);

  return (
    <div className="min-h-screen bg-background font-sans">
      {/* The MOCK MODE banner that used to sit here is gone deliberately.
          It rendered on `VITE_USE_MOCK_DATA`, a value fixed when the bundle is
          built, so it described the build and not the data: with the flag off —
          its normal state — the dashboard drew 608 rows of fixtures under no
          warning at all, and with the flag on it would have warned about real
          Meta rows too. A badge that can be wrong in both directions is worse
          than none, because it gets trusted.

          Provenance is now reported by `DataSourceBadge`, which reads the
          `data_source` of the rows actually rendered. It lives next to those
          rows on the Dashboard; other pages get one as they learn to report
          which sources they drew from. */}
      <AppSidebar />
      <div
        className={cn(
          "transition-all duration-300 min-h-screen",
          collapsed ? "pl-20" : "pl-72",
        )}
      >
        <Header />
        <main className="px-6 pt-6 pb-2">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
