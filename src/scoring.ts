// Pure scoring rules, kept separate so they're easy to read and test.
//
// Four daily goals:
//   calories: cut  -> at or under calorie_target (but not under the cut floor)
//                bulk -> at or over calorie_target
//   protein:  at or over protein_target
//   sleep:    slept at least the sleep target that night
//   wake-up:  woke up by the day's wake time (weekday or weekend) plus the grace period
// Food goals need at least one logged entry that day, so not logging isn't a free "cut" win,
// and none of the day's entries can be a bare total ("I hit 3000 today") with no foods behind it.
// Fat and carbs are tracked and shown but aren't goals.

import { localParts, weekdayOf } from "./time";

export type GoalType = "cut" | "bulk";

export interface Goal {
  goal_type: GoalType | null;
  calorie_target: number | null;
  protein_target: number | null;
}

export interface Rules {
  tz: string;
  sleepTargetMinutes: number;
  cutFloorCalories: number;
  wakeWeekday: number; // minutes after midnight, e.g. 510 = 8:30am
  wakeWeekend: number;
  wakeGraceMinutes: number;
  calorieGrace?: number; // calories past the target that still count (estimates aren't that precise)
  proteinGrace?: number; // grams short of the protein target that still count
  breakDays?: Set<string>; // school breaks and holidays: weekday dates that use the weekend wake time
}

export interface DayStats {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  sugar?: number | null; // total sugar, null if no item that day has an estimate
  addedSugar?: number | null;
  foodCount: number;
  unitemized?: number; // entries that are a calorie number with no actual foods
  sleepMinutes: number | null;
  wakeAt: string | null; // ISO time they got up (the night's sleep ends on this day)
  bedAt?: string | null;
}

export const EMPTY_DAY: DayStats = { calories: 0, protein: 0, fat: 0, carbs: 0, foodCount: 0, sleepMinutes: null, wakeAt: null };

export interface DayScore {
  calOk: boolean;
  proteinOk: boolean;
  sleepOk: boolean;
  wakeOk: boolean;
  points: number;
}

export function calorieGoalMet(goal: Goal, stats: DayStats, rules: Rules): boolean {
  if (stats.foodCount === 0 || stats.unitemized || goal.goal_type == null || goal.calorie_target == null) return false;
  const grace = rules.calorieGrace ?? 0;
  return goal.goal_type === "cut"
    ? stats.calories <= goal.calorie_target + grace && stats.calories >= rules.cutFloorCalories
    : stats.calories >= goal.calorie_target - grace;
}

export function proteinGoalMet(goal: Goal, stats: DayStats, rules?: Rules): boolean {
  if (stats.foodCount === 0 || stats.unitemized || goal.protein_target == null) return false;
  return stats.protein >= goal.protein_target - (rules?.proteinGrace ?? 0);
}

/**
 * A food entry that's really a total ("Daily calorie total (user reported 3,000)") rather than food:
 * the description says so, or it's a big number with no fat or carbs, which no real food has.
 */
export function looksUnitemized(item: { description: string; calories: number; fat_g: number; carbs_g: number }): boolean {
  if (/\b(total|totals|overall|self[- ]reported|user[- ]reported|reported|unspecified|not specified|not provided|macros unknown)\b/i.test(item.description) && item.calories >= 300) return true;
  return item.calories >= 150 && item.fat_g === 0 && item.carbs_g === 0;
}

export function sleepGoalMet(stats: DayStats, rules: Rules): boolean {
  return stats.sleepMinutes != null && stats.sleepMinutes >= rules.sleepTargetMinutes;
}

/** The wake-up time for a day, in minutes after midnight (weekends and break days use the weekend time). */
export function wakeTarget(day: string, rules: Rules): number {
  const wd = weekdayOf(day);
  return wd === 0 || wd === 6 || rules.breakDays?.has(day) ? rules.wakeWeekend : rules.wakeWeekday;
}

export function wakeMinutes(wakeAt: string, tz: string): number {
  const p = localParts(new Date(wakeAt), tz);
  return p.hour * 60 + p.minute;
}

export function wakeGoalMet(day: string, stats: DayStats, rules: Rules): boolean {
  if (stats.wakeAt == null) return false;
  return wakeMinutes(stats.wakeAt, rules.tz) <= wakeTarget(day, rules) + rules.wakeGraceMinutes;
}

export function scoreDay(goal: Goal, stats: DayStats, rules: Rules, day: string): DayScore {
  const calOk = calorieGoalMet(goal, stats, rules);
  const proteinOk = proteinGoalMet(goal, stats, rules);
  const sleepOk = sleepGoalMet(stats, rules);
  const wakeOk = wakeGoalMet(day, stats, rules);
  return { calOk, proteinOk, sleepOk, wakeOk, points: +calOk + +proteinOk + +sleepOk + +wakeOk };
}

// ---------- goal status (what the pages show instead of points) ----------

/** hit, close (within NEAR of the goal), missed, nothing logged, or still in progress today. */
export type GoalStatus = "hit" | "near" | "miss" | "none" | "now";

export interface DayStatus {
  cal: GoalStatus;
  protein: GoalStatus;
  sleep: GoalStatus;
  wake: GoalStatus;
}

export const GOAL_KEYS = ["cal", "protein", "sleep", "wake"] as const;

/** How close counts as "close": 10% on food, 30 minutes on sleep and wake-up. */
export const NEAR = { food: 0.1, minutes: 30 };

export function dayStatus(goal: Goal, s: DayStats, rules: Rules, day: string, today: string): DayStatus {
  const live = day === today;
  const sc = scoreDay(goal, s, rules, day);
  let cal: GoalStatus = "none";
  if (s.foodCount > 0 && goal.calorie_target != null && goal.goal_type) {
    const t = goal.calorie_target;
    const grace = rules.calorieGrace ?? 0;
    if (sc.calOk) cal = live && goal.goal_type === "cut" ? "now" : "hit";
    else if (s.unitemized) cal = "miss";
    else if (goal.goal_type === "cut") {
      if (s.calories > t + grace) cal = s.calories <= t * (1 + NEAR.food) ? "near" : "miss";
      else cal = live ? "now" : "miss"; // under the floor
    } else cal = live ? "now" : s.calories >= t * (1 - NEAR.food) ? "near" : "miss";
  }
  let protein: GoalStatus = "none";
  if (s.foodCount > 0 && goal.protein_target != null) {
    if (sc.proteinOk) protein = "hit";
    else if (s.unitemized) protein = "miss";
    else protein = live ? "now" : s.protein >= goal.protein_target * (1 - NEAR.food) ? "near" : "miss";
  }
  const sleep: GoalStatus =
    s.sleepMinutes == null ? "none" : sc.sleepOk ? "hit" : s.sleepMinutes >= rules.sleepTargetMinutes - NEAR.minutes ? "near" : "miss";
  let wake: GoalStatus = "none";
  if (s.wakeAt != null) {
    const late = wakeMinutes(s.wakeAt, rules.tz) - wakeTarget(day, rules) - rules.wakeGraceMinutes;
    wake = sc.wakeOk ? "hit" : late <= NEAR.minutes ? "near" : "miss";
  }
  return { cal, protein, sleep, wake };
}
