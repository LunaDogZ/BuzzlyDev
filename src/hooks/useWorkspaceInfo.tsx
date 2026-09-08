import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentUser } from '@/lib/currentUser';

export interface WorkspaceInfo {
    id: string;
    name: string;
    logo_url: string | null;
    plan: string;
}

export function useWorkspaceInfo() {
    return useQuery({
        queryKey: ['workspace-info'],
        queryFn: async (): Promise<WorkspaceInfo | null> => {
            const { data: { user } } = await getCurrentUser();
            if (!user) return null;

            // 1. Try fetching workspace owned by user
            const { data: workspaceData } = await supabase
                .from('workspaces')
                .select('id, name, logo_url')
                .eq('owner_id', user.id)
                .maybeSingle();

            if (workspaceData) {
                return {
                    id: workspaceData.id,
                    name: workspaceData.name,
                    logo_url: workspaceData.logo_url,
                    plan: 'Team Plan', // Determining plan logic can be complex, simplifying for display
                };
            }

            // 2. Try fetching workspace where user is a member
            const { data: memberData } = await supabase
                .from('workspace_members')
                .select('team_id, workspaces(id, name, logo_url)')
                .eq('user_id', user.id)
                .eq('status', 'active')
                .maybeSingle();

            if (memberData?.workspaces) {
                const workspace = memberData.workspaces;
                return {
                    id: workspace.id,
                    name: workspace.name,
                    logo_url: workspace.logo_url,
                    plan: 'Team Plan',
                };
            }

            return null;
        },
        staleTime: 1000 * 60 * 5, // 5 minutes
    });
}
