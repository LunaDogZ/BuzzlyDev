/**
 * missionHelpers.ts
 * ─────────────────────────────────────────────────────────────
 * Pure utility functions for Mission Board calculations.
 *
 * These helpers are intentionally framework-agnostic and import-free so
 * they can be unit-tested in isolation and reused by any component or hook.
 *
 * For the real Mission type from the hook, these same calculations are
 * already handled inside useLoyaltyTier. These helpers expose the logic
 * explicitly for documentation and team-collaboration purposes.
 * ─────────────────────────────────────────────────────────────
 */

import type { Mission } from '@/hooks/useLoyaltyTier';

// ─── Icon Map ─────────────────────────────────────────────────────────────────
// Maps action_code / action_type → visual emoji for the Mission Board rows.
// Defined here (outside the component) so teammates can add new icons without
// changing any rendering logic.
//
// TODO: When real missions are added in the admin panel, add their action_code
//       entries here to get a custom icon. Fallback is 🎯.
export const MISSION_ICONS: Record<string, string> = {
  // ── Legacy loyalty_missions.action_type keys ──────────────────
  create_workspace: '🏗️',
  connect_api:      '🔌',
  upgrade_plan:     '⭐',
  create_campaign:  '🚀',

  // ── Canonical loyalty_activity_codes.action_code keys ───────────
  // ← match these exactly to the 4 missions in missionsMockData.ts
  // create_workspace already mapped above
  first_campaign:   '🚀',
  connect_ad_api:   '🔌',  // Ad Platform API connection
  pro_upgrade:      '⭐',   // Pro/Team plan upgrade

  // ── Legacy deactivated codes (kept for historical display) ───────
  connect_line_oa:  '💬',
  survey_completion: '📋',
  referral_signup:  '🤝',
  yearly_sub_bonus: '🎁',
} as const;

// ─── Calculation Helpers ──────────────────────────────────────────────────────

/**
 * calculateEarnedPoints
 * ─────────────────────
 * Sums reward_points for all missions that are marked as completed.
 *
 * Works with both the real Mission shape (isCompleted flag) and the
 * MockMission shape (status === 'completed').
 *
 * @param missions  Array of real or mock mission objects.
 * @returns         Total points earned by the user so far.
 */
export function calculateEarnedPoints(missions: Mission[]): number {
  // Sum points_awarded for every mission where isCompleted is true.
  return missions.reduce(
    (total, mission) => total + (mission.isCompleted ? mission.points_awarded : 0),
    0
  );
}

/**
 * calculateTotalPoints
 * ─────────────────────
 * Sums reward_points across ALL missions regardless of completion status.
 * This is the denominator for the progress percentage.
 *
 * @param missions  Array of real or mock mission objects.
 * @returns         Maximum possible points the user could earn.
 */
export function calculateTotalPoints(missions: Mission[]): number {
  return missions.reduce((total, mission) => total + mission.points_awarded, 0);
}

/**
 * calculateProgressPercent
 * ────────────────────────
 * Computes the overall Mission Board progress bar fill value.
 *
 * Formula: (earnedPoints / totalPoints) × 100, clamped to [0, 100].
 * Returns 0 when totalPoints is 0 (avoids division by zero).
 *
 * @param earnedPoints  Points earned (see calculateEarnedPoints).
 * @param totalPoints   Total available points (see calculateTotalPoints).
 * @returns             Integer 0–100 suitable for a <Progress value={...} />.
 */
export function calculateProgressPercent(
  earnedPoints: number,
  totalPoints: number
): number {
  if (totalPoints <= 0) return 0;
  return Math.min(100, Math.round((earnedPoints / totalPoints) * 100));
}
