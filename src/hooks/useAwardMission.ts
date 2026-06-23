import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { logError } from '@/services/errorLogger';
import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

export interface MissionResult {
  success: boolean;
  points_awarded?: number;
  new_balance?: number;
  reason?: string; // 'already_claimed' for duplicate one-time missions
}

/**
 * Thin wrapper around the award_loyalty_points() Supabase RPC.
 *
 * Usage:
 *   const { awardMission } = useAwardMission();
 *   const result = await awardMission('create_workspace');
 *   if (result?.success) { ... show toast ... }
 */
export function useAwardMission() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const awardMission = useCallback(
    async (actionType: string): Promise<MissionResult | null> => {
      try {
        const { data, error } = await supabase.rpc(
          // Cast to any: award_loyalty_points is a new RPC not yet in the
          // generated types snapshot. Update types (supabase gen types) to remove this cast.
          'award_loyalty_points',
          { p_action_type: actionType }
        );

        if (error) {
          void logError('useAwardMission.rpc', new Error(error.message), {
            hook: 'useAwardMission',
            actionType,
            code: error.code,
          });
          toast({
            variant: 'destructive',
            title: 'Could not update points',
            description:
              'Loyalty mission could not be saved. Check Supabase env (URL + anon key) and that migrations are applied.',
          });
          return null;
        }

        if (data && (data as unknown as MissionResult).success) {
          window.dispatchEvent(new CustomEvent('loyalty-refetch'));
          queryClient.invalidateQueries({ queryKey: ['loyalty-missions'] });
          queryClient.invalidateQueries({ queryKey: ['loyalty-tier'] });
        }

        return data as unknown as MissionResult;
      } catch (err) {
        void logError('useAwardMission', err, { hook: 'useAwardMission', actionType });
        toast({
          variant: 'destructive',
          title: 'Could not update points',
          description: 'Something went wrong while awarding loyalty points. Please try again.',
        });
        return null;
      }
    },
    [queryClient, toast]
  );

  return { awardMission };
}
