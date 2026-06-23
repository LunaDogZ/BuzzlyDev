import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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

export function useWorkspace() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { awardMission } = useAwardMission();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceData>({
    id: null,
    name: '',
    description: '',
    logo_url: '',
    workspace_url: '',
    timezone: 'Asia/Bangkok',
    business_type_id: '',
    industries_id: '',
    company_name: '',
  });
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([]);
  const [industries, setIndustries] = useState<Industry[]>([]);
  const [hasTeam, setHasTeam] = useState(false);

  // Fetch user's team and reference data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        // Get current user
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          setLoading(false);
          return;
        }

        // Fetch business types
        const { data: businessTypesData } = await supabase
          .from('business_types')
          .select('id, name, slug, description')
          .eq('is_active', true)
          .order('display_order');

        if (businessTypesData) {
          setBusinessTypes(businessTypesData);
        }

        // Fetch industries
        const { data: industriesData } = await supabase
          .from('industries')
          .select('id, name, slug, description')
          .eq('is_active', true)
          .order('display_order');

        if (industriesData) {
          setIndustries(industriesData);
        }

        // Fetch user's workspace (as owner)
        const { data: workspaceData } = await supabase
          .from('workspaces')
          .select('*')
          .eq('owner_id', user.id)
          .maybeSingle() as { data: Team | null, error: unknown };

        if (workspaceData) {
          setHasTeam(true);
          setWorkspace({
            id: workspaceData.id,
            name: workspaceData.name || '',
            description: workspaceData.description || '',
            logo_url: workspaceData.logo_url || '',
            workspace_url: workspaceData.workspace_url || '',
            timezone: workspaceData.timezone || 'Asia/Bangkok',
            business_type_id: workspaceData.business_type_id || '',
            industries_id: workspaceData.industries_id || '',
            company_name: workspaceData.company_name || '',
          });
        } else {
          // Check if user is a member of any workspace
          const { data: memberData } = await supabase
            .from('workspace_members')
            .select('team_id, workspaces(*)')
            .eq('user_id', user.id)
            .eq('status', 'active')
            .maybeSingle();

          if (memberData?.workspaces) {
            const workspace = memberData.workspaces as unknown as Team;
            setHasTeam(true);
            setWorkspace({
              id: workspace.id,
              name: workspace.name || '',
              description: workspace.description || '',
              logo_url: workspace.logo_url || '',
              workspace_url: workspace.workspace_url || '',
              timezone: workspace.timezone || 'Asia/Bangkok',
              business_type_id: workspace.business_type_id || '',
              industries_id: workspace.industries_id || '',
              company_name: workspace.company_name || '',
            });
          }
        }
      } catch (error) {
        console.error('Error fetching workspace data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Create new workspace
  const createWorkspace = async (name: string) => {
    try {
      setSaving(true);
      const { data: { user } } = await supabase.auth.getUser();
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

      setHasTeam(true);
      setWorkspace({
        id: data.id,
        name: data.name,
        description: '',
        logo_url: '',
        workspace_url: '',
        timezone: 'Asia/Bangkok',
        business_type_id: '',
        industries_id: '',
        company_name: '',
      });

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
      const { data: { user } } = await supabase.auth.getUser();
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
