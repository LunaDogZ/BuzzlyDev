import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentUser } from '@/lib/currentUser';
import { getErrorMessage } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useAwardMission } from '@/hooks/useAwardMission';
import { auditSettings } from '@/lib/auditLogger';

interface Team {
  id: string;
  name: string;
  description: string | null;
  owner_id: string;
  logo_url: string | null;
  workspace_url: string | null;
  status: string | null;
  timezone: string | null;
  business_type_id: string | null;
  industries_id: string | null;
  created_at: string;
  updated_at: string;
  company_name: string | null;
}

interface BusinessType {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
}

interface Industry {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
}

interface WorkspaceData {
  id: string | null;
  name: string;
  description: string;
  logo_url: string;
  workspace_url: string;
  timezone: string;
  business_type_id: string;
  industries_id: string;
  company_name: string;
}

/** One key for one workspace read, so every caller shares the same request. */
export const WORKSPACE_QUERY_KEY = ['workspace', 'current'] as const;

const EMPTY_WORKSPACE: WorkspaceData = {
  id: null,
  name: '',
  description: '',
  logo_url: '',
  workspace_url: '',
  timezone: 'Asia/Bangkok',
  business_type_id: '',
  industries_id: '',
  company_name: '',
};

/** The row shape the form works in. Was written out twice, once per lookup path. */
function toWorkspaceData(team: Team): WorkspaceData {
  return {
    id: team.id,
    name: team.name || '',
    description: team.description || '',
    logo_url: team.logo_url || '',
    workspace_url: team.workspace_url || '',
    timezone: team.timezone || 'Asia/Bangkok',
    business_type_id: team.business_type_id || '',
    industries_id: team.industries_id || '',
    company_name: team.company_name || '',
  };
}

/** What the shared read caches: the workspace, and how the user reached it. */
export interface CurrentWorkspace {
  workspace: WorkspaceData;
  /** True when the user owns it, false when they reached it through membership.
   *  Carried here because permission checks need it and it is free at this
   *  point — deriving it later costs another query. */
  isOwner: boolean;
}

/**
 * The workspace the signed-in user owns, or failing that the one they are an
 * active member of. Returns null when they have neither — that is "no workspace
 * yet", not an error.
 */
async function fetchCurrentWorkspace(): Promise<CurrentWorkspace | null> {
  const { data: { user } } = await getCurrentUser();
  if (!user) return null;

  const { data: owned } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_id', user.id)
    .maybeSingle() as { data: Team | null; error: unknown };

  if (owned) return { workspace: toWorkspaceData(owned), isOwner: true };

  const { data: membership } = await supabase
    .from('workspace_members')
    .select('team_id, workspaces(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .maybeSingle();

  if (membership?.workspaces) {
    return { workspace: toWorkspaceData(membership.workspaces as unknown as Team), isOwner: false };
  }

  return null;
}

/** The cached read itself, for callers that need more than the id. */
export async function fetchCurrentWorkspaceContext(
  queryClient: QueryClient,
): Promise<CurrentWorkspace | null> {
  return queryClient.fetchQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: fetchCurrentWorkspace,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * The current workspace id, for code that needs it from inside a queryFn rather
 * than from a hook.
 *
 * Six hooks each carried their own copy of this lookup — useScheduledReports,
 * useTags, useBudgets, useReports, useWorkspaceMembers, useTeamPermissions —
 * so a dashboard load asked "which workspace am I in?" once per hook. Routed
 * through `fetchQuery`, they share the answer already in the cache and the
 * concurrent ones share a single request.
 *
 * ⚠️ This unifies a semantic difference rather than preserving it. Three of the
 * six copies (useScheduledReports, useTags, useBudgets) matched a
 * `workspace_members` row *without* checking `status`, so a suspended or
 * pending member still resolved to a workspace there, while the other three and
 * `useWorkspace` required `status = 'active'`. This resolver requires active
 * membership. That is a behaviour change, deliberately taken in the safer
 * direction and pinned by a test — not an accident of refactoring.
 */
export async function fetchCurrentWorkspaceId(queryClient: QueryClient): Promise<string | null> {
  const current = await fetchCurrentWorkspaceContext(queryClient);
  return current?.workspace.id ?? null;
}

/**
 * `withLookups` pulls the business-type and industry dropdown lists.
 *
 * They are reference data for one form — the workspace settings page — but they
 * used to be fetched by every caller of this hook, and fetched *before* the
 * workspace itself, so every page paid for them twice over: two requests it had
 * no use for, and a delay on the one request it did need. A dashboard load
 * fetched each list five times, because five of its hooks call this one
 * (evidence/kpi4-lighthouse/4c13722/desktop/R2-dashboard/run-2.json).
 *
 * Off by default, so a caller that renders the dropdowns has to say so.
 */
export function useWorkspace({ withLookups = false }: { withLookups?: boolean } = {}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { awardMission } = useAwardMission();
  const [saving, setSaving] = useState(false);

  // The server read, shared by every caller through one query key.
  const { data: current, isLoading: loading } = useQuery({
    queryKey: WORKSPACE_QUERY_KEY,
    queryFn: fetchCurrentWorkspace,
  });

  const fetchedWorkspace = current?.workspace ?? null;
  const hasTeam = !!current;

  // The settings form edits the workspace in place, so the returned object has
  // to stay writable — `setWorkspace` is what the inputs call on every keystroke.
  // It is seeded from the query rather than replaced by it: syncing on the id
  // means a background refetch cannot overwrite half-typed edits.
  const [workspace, setWorkspace] = useState<WorkspaceData>(EMPTY_WORKSPACE);
  const seededId = useRef<string | null>(null);

  useEffect(() => {
    if (fetchedWorkspace && fetchedWorkspace.id !== seededId.current) {
      seededId.current = fetchedWorkspace.id;
      setWorkspace(fetchedWorkspace);
    }
  }, [fetchedWorkspace]);

  // Reference data for the settings form only, and gated on the workspace read
  // so it cannot be issued in front of the request the page is waiting for.
  const { data: lookups } = useQuery({
    queryKey: ['workspace', 'lookups'],
    enabled: withLookups && !loading,
    queryFn: async () => {
      const [{ data: businessTypesData }, { data: industriesData }] = await Promise.all([
        supabase
          .from('business_types')
          .select('id, name, slug, description')
          .eq('is_active', true)
          .order('display_order'),
        supabase
          .from('industries')
          .select('id, name, slug, description')
          .eq('is_active', true)
          .order('display_order'),
      ]);
      return {
        businessTypes: (businessTypesData || []) as BusinessType[],
        industries: (industriesData || []) as Industry[],
      };
    },
  });

  const businessTypes = lookups?.businessTypes ?? [];
  const industries = lookups?.industries ?? [];


  // Create new workspace
  const createWorkspace = async (name: string) => {
    try {
      setSaving(true);
      const { data: { user } } = await getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('workspaces')
        .insert({
          name,
          owner_id: user.id,
          description: '',
        })
        .select()
        .single();

      if (error) throw error;

      // Add owner as workspace member
      await supabase
        .from('workspace_members')
        .insert({
          team_id: data.id,
          user_id: user.id,
          role: 'owner',
          status: 'active',
        });

      // Written straight into the cache rather than invalidated: `hasTeam` is
      // read the moment this returns, and a refetch would leave the caller
      // looking at "no workspace" for a round trip after creating one.
      const created: WorkspaceData = { ...EMPTY_WORKSPACE, id: data.id, name: data.name };
      queryClient.setQueryData<CurrentWorkspace>(WORKSPACE_QUERY_KEY, {
        workspace: created,
        isOwner: true,   // they just created it
      });
      seededId.current = data.id;
      setWorkspace(created);

      // Notify usePlatformConnections (on any page) to re-fetch with new teamId
      // This allows instant platform connection without a manual page refresh
      window.dispatchEvent(new CustomEvent('workspace-created'));

      toast({
        title: 'Workspace created successfully',
        description: `Workspace "${name}" has been created`,
      });

      // Mission 1: award points for creating the first workspace (one-time)
      const missionResult = await awardMission('create_workspace');
      if (missionResult?.success) {
        toast({
          title: '🎉 Mission Complete!',
          description: `+${missionResult.points_awarded} Points for creating your Workspace!`,
        });
      }

      // Log workspace creation
      await auditSettings.settingsChanged(user.id, 'Workspace Created', null, name);

      return data;
    } catch (error) {
      toast({
        title: 'An error occurred',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Save workspace settings
  const saveWorkspace = async (data: Partial<WorkspaceData>) => {
    if (!workspace.id) return false;

    try {
      setSaving(true);

      const updateData: Record<string, unknown> = {
        name: data.name,
        description: data.description || null,
        logo_url: data.logo_url || null,
        workspace_url: data.workspace_url || null,
        timezone: data.timezone || null,
        business_type_id: data.business_type_id || null,
        industries_id: data.industries_id || null,
        company_name: data.company_name || null,
      };

      const { error } = await supabase
        .from('workspaces')
        .update(updateData)
        .eq('id', workspace.id);

      if (error) throw error;

      // Log the workspace settings update + sync company_name
      const { data: { user } } = await getCurrentUser();
      if (user) {
        await auditSettings.settingsChanged(
          user.id,
          'Workspace Settings Updated',
          null,
          { name: data.name, company_name: data.company_name }
        );

        // Sync company_name to customer table for consistent billing/profile data
        if (data.company_name !== undefined) {
          await supabase
            .from('customer')
            .update({ company_name: data.company_name })
            .eq('id', user.id);
        }
      }

      setWorkspace(prev => ({ ...prev, ...data }));

      // Keep the shared read in step with what was just written, so the other
      // callers of this hook do not go on serving the pre-save values.
      queryClient.setQueryData<CurrentWorkspace | null>(
        WORKSPACE_QUERY_KEY,
        (prev) => (prev ? { ...prev, workspace: { ...prev.workspace, ...data } } : prev),
      );

      // Invalidate the workspace-info query to update Sidebar immediately
      queryClient.invalidateQueries({ queryKey: ['workspace-info'] });

      toast({
        title: 'Saved successfully',
        description: 'Workspace settings have been updated',
      });

      return true;
    } catch (error) {
      toast({
        title: 'An error occurred',
        description: getErrorMessage(error),
        variant: 'destructive',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    workspace,
    setWorkspace,
    businessTypes,
    industries,
    loading,
    saving,
    hasTeam,
    createWorkspace,
    saveWorkspace,
  };
}
