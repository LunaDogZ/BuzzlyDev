import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentUser } from '@/lib/currentUser';
import type { TeamInvitation, TeamRole, InvitationStatus, TeamPermissions } from '@/hooks/useTeamManagement';

/**
 * The pending invitations addressed to the signed-in user, and nothing else.
 *
 * The sidebar renders one number from this — how many invitations are waiting —
 * on every page of the app. It used to get that number from `useTeamManagement`,
 * which loads the whole team-management screen: the workspace, its members,
 * every invitation it has sent, the activity log, and a profile lookup for each
 * of them. A dashboard load carried all of it and displayed a digit
 * (evidence/kpi4-lighthouse/4c13722/desktop/R2-dashboard/run-2.json).
 *
 * `useTeamManagement` stays exactly as it is for the screens that manage a team,
 * including the notification popover, which needs accept and decline and only
 * mounts when someone opens it.
 */
export function useReceivedInvitations() {
  const [receivedInvitations, setReceivedInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchReceivedInvitations = useCallback(async () => {
    try {
      const { data: { user } } = await getCurrentUser();
      if (!user?.email) {
        setReceivedInvitations([]);
        return;
      }

      const { data, error } = await supabase
        .from('team_invitations')
        .select('*, workspaces(name)')
        .eq('email', user.email)
        .eq('status', 'pending' as InvitationStatus)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching received invitations:', error);
        return;
      }

      // Only look up inviter names when there is something to show for it.
      const inviterIds = [...new Set((data || []).map((i) => i.invited_by))];
      const profileMap = new Map<string, { id: string; email: string | null; full_name: string | null }>();

      if (inviterIds.length > 0) {
        const { data: profiles } = await supabase
          .from('customer')
          .select('id, email, full_name')
          .in('id', inviterIds);
        for (const p of profiles || []) profileMap.set(p.id, p);
      }

      setReceivedInvitations(
        (data || []).map((inv) => ({
          ...inv,
          role: inv.role as TeamRole,
          status: inv.status as InvitationStatus,
          custom_permissions: inv.custom_permissions as unknown as TeamPermissions | null,
          inviter: profileMap.get(inv.invited_by) || undefined,
          team: inv.workspaces,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReceivedInvitations();
  }, [fetchReceivedInvitations]);

  return { receivedInvitations, loading, refetch: fetchReceivedInvitations };
}
