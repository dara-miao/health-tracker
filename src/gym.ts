// Gym consistency: a GitHub-style grid and a weekly streak. Not part of the score.
import { addDays, weekStart } from "./time";

export type WorkoutKind = "gym" | "sport" | "run";
export const WORKOUT_KINDS: WorkoutKind[] = ["gym", "sport", "run"];

export interface Workout {
  id?: number;
  day: string;
  kind: WorkoutKind;
  note: string | null;
}

/** Workouts per day. A day can have more than one. */
export type DayCounts = Map<string, number>;

export function countByDay(days: string[]): DayCounts {
  const counts: DayCounts = new Map();
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  return counts;
}

/** Workouts in the Monday-to-Sunday week containing `day` (two in one day count as two). */
export function weekCount(days: DayCounts, day: string): number {
  const start = weekStart(day);
  let n = 0;
  for (let i = 0; i < 7; i++) n += days.get(addDays(start, i)) ?? 0;
  return n;
}

/**
 * Consecutive weeks that hit the target, ending with the current week if it's already hit,
 * otherwise with last week (the current week is still in progress, so it can't break a streak).
 * Weeks before the week of `from` don't count.
 */
export function weekStreak(days: DayCounts, target: number | null, from: string, today: string): number {
  if (!target) return 0;
  const first = weekStart(from);
  let week = weekStart(today);
  if (weekCount(days, week) < target) week = addDays(week, -7);
  let streak = 0;
  while (week >= first && weekCount(days, week) >= target) {
    streak++;
    week = addDays(week, -7);
  }
  return streak;
}
