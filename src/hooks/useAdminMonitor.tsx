import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from '@/lib/currentUser';

export interface ServerHealth {
  id: string;
  hostname: string | null;
  status: string | null;
  cpu_usage_percent: number | null;
  used_memory: number | null;
  total_memory: number | null;
  disk_used: number | null;
  disk_total: number | null;
  ip_address: string | null;
}

export interface DataPipeline {
  id: string;
  name: string;
  status: string | null;
  schedule_cron: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
}

export interface ExternalAPIStatus {
  id: string;
  platform_id: string | null;
  platform_name?: string;
  last_status_code: number | null;
  latency_ms: number | null;
  color_code: string | null;
}

export function computeServerStatus(server: {
  cpu_usage_percent?: string | number | null;
  total_memory?: string | number | null;
  used_memory?: string | number | null;
  disk_total?: string | number | null;
  disk_used?: string | number | null;
}): string {
  const cpu = parseFloat(String(server.cpu_usage_percent ?? '0'));

  let memUsagePct = 0;
  if (server.total_memory && Number(server.total_memory) > 0) {
    memUsagePct = (Number(server.used_memory || 0) / Number(server.total_memory)) * 100;
  }

  let diskUsagePct = 0;
  if (server.disk_total && Number(server.disk_total) > 0) {
    diskUsagePct = (Number(server.disk_used || 0) / Number(server.disk_total)) * 100;
  }

  if (cpu > 90 || diskUsagePct > 95 || memUsagePct > 95) return 'critical';
  if (cpu > 80 || diskUsagePct > 85 || memUsagePct > 85) return 'warning';

  return 'healthy';
}

export function useServerHealth() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("admin-server-health-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "server" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-server-health"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["admin-server-health"],
    refetchInterval: 10000,
    queryFn: async (): Promise<ServerHealth[]> => {
      const { data, error } = await supabase
        .from("server")
        .select("id, hostname, status, cpu_usage_percent, used_memory, total_memory, disk_used, disk_total, ip_address")
        .order("hostname");

      if (error) throw error;

      // Fallback compute status if db trigger hasn't fired yet
      return (data || []).map((server) => ({
        ...server,
        status: server.status === 'healthy' && computeServerStatus(server) !== 'healthy'
          ? computeServerStatus(server)
          : server.status
      }));
    },
  });
}

export function useDataPipelines() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("admin-pipelines-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "data_pipeline" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-data-pipelines"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["admin-data-pipelines"],
    refetchInterval: 10000,
    queryFn: async (): Promise<DataPipeline[]> => {
      const { data, error } = await supabase
        .from("data_pipeline")
        .select("id, name, status, schedule_cron, last_run_at, next_run_at")
        .order("name");

      if (error) throw error;
      return data || [];
    },
  });
}

export function useExternalAPIStatus() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("admin-external-api-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "external_api_status" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-external-api-status"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["admin-external-api-status"],
    refetchInterval: 10000,
    queryFn: async (): Promise<ExternalAPIStatus[]> => {
      const { data, error } = await supabase
        .from("external_api_status")
        .select(`
          id, 
          platform_id, 
          last_status_code, 
          latency_ms, 
          color_code,
          platforms:platform_id (name)
        `);

      if (error) throw error;

      return (data || []).map((item) => ({
        ...item,
        platform_name: item.platforms?.name || "Unknown",
      }));
    },
  });
}

export function useErrorLogStats() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("admin-error-logs-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "error_logs" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-error-log-stats"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["admin-error-log-stats"],
    refetchInterval: 10000,
    queryFn: async () => {
      // DEBUG: Verify User Identity and Permissions
      const { data: { user } } = await getCurrentUser();
      console.log("Debug - Current Auth User:", user?.id, user?.email);

      if (user) {
        // Try to fetch employee record to verify RLS ('has_role') is working
        const { data: emp, error: empErr } = await supabase
          .from("employees")
          .select("*, role_employees(role_name)")
          .eq("user_id", user.id);

        console.log("Debug - Employee Record:", emp);
        if (empErr) console.error("Debug - Employee Fetch Error:", empErr);
      }

      // Fetch the last 500 error logs to perform JS aggregation on the frontend
      const { data, error } = await supabase
        .from("error_logs")
        .select("id, level, message, created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (error) throw error;

      return data || [];
    },
  });
}

export function usePerformanceMetrics() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("admin-perf-metrics-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "server" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["admin-performance-metrics"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: ["admin-performance-metrics"],
    refetchInterval: 10000,
    queryFn: async () => {
      // Query from server table for performance data
      const { data: rawServers, error } = await supabase
        .from("server")
        .select("cpu_usage_percent, used_memory, total_memory, disk_used, disk_total, status");

      if (error) throw error;

      // Apply computed status
      const servers = (rawServers || []).map((s) => ({
        ...s,
        status: s.status === 'healthy' && computeServerStatus(s) !== 'healthy'
          ? computeServerStatus(s)
          : s.status
      }));

      const activeServers = servers.filter((s) => s.status === "healthy");
      const avgCpu = activeServers.length
        ? activeServers.reduce((sum, s) => sum + (Number(s.cpu_usage_percent) || 0), 0) / activeServers.length
        : 0;

      const totalMemory = activeServers.reduce((sum, s) => sum + (Number(s.total_memory) || 0), 0);
      const usedMemory = activeServers.reduce((sum, s) => sum + (Number(s.used_memory) || 0), 0);
      const avgMemory = totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0;

      const totalDisk = activeServers.reduce((sum, s) => sum + (Number(s.disk_total) || 0), 0);
      const usedDisk = activeServers.reduce((sum, s) => sum + (Number(s.disk_used) || 0), 0);
      const avgDisk = totalDisk > 0 ? (usedDisk / totalDisk) * 100 : 0;

      return {
        avgCpuUsage: Math.round(avgCpu),
        avgMemoryUsage: Math.round(avgMemory),
        avgDiskUsage: Math.round(avgDisk),
        totalServers: servers?.length || 0,
        healthyServers: activeServers.length,
        warningServers: servers?.filter((s) => s.status === "warning").length || 0,
        criticalServers: servers?.filter((s) => s.status === "critical").length || 0,
      };
    },
  });
}
