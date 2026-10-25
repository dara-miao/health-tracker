import * as db from "./db";
import type { Env, MealWithItems, Player } from "./db";
import { EMPTY_DAY, GOAL_KEYS, calorieGoalMet, dayStatus, proteinGoalMet, scoreDay, sleepGoalMet, wakeMinutes, wakeTarget, type DayStats, type DayStatus } from "./scoring";
import { countByDay, weekCount, weekStreak, type Workout } from "./gym";
import { addDays, gameDay, localParts, prettyClock, prettyDay, prettyDuration, prettyTime, weekDays, weekdayOf, weekStart } from "./time";

const MAX_SLEEP_MINUTES = 16 * 60;

/** A problem with what the player asked for; the message is shown back to their agent. */
export class UserError extends Error {}

// ---------- sleep ----------

/** Sleep counts toward the calendar day you wake up on. */
export function sleepDay(wakeAt: Date, tz: string): string {
  const p = localParts(wakeAt, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export async function goToBed(env: Env, player: Player, at: Date): Promise<string> {
  await db.setPendingBed(env.DB, player.id, at.toISOString());
  return `Bedtime logged at ${prettyTime(at.toISOString(), env.GAME_TZ)}.`;
}

export async function wakeUp(env: Env, player: Player, at: Date): Promise<string> {
  if (!player.pending_bed_at) {
    throw new UserError("No bedtime on record. Ask what time they fell asleep, then use log_sleep with both times.");
  }
  const result = await logNight(env, player, new Date(player.pending_bed_at), at);
  await db.setPendingBed(env.DB, player.id, null);
  return result;
}

export async function logNight(env: Env, player: Player, bed: Date, wake: Date): Promise<string> {
  const minutes = Math.round((wake.getTime() - bed.getTime()) / 60000);
  if (!(minutes > 0)) throw new UserError("Wake time must be after bedtime.");
  if (minutes > MAX_SLEEP_MINUTES) {
    throw new UserError(`That's ${prettyDuration(minutes)}, over the ${MAX_SLEEP_MINUTES / 60}h max. Confirm the times.`);
  }
  const day = sleepDay(wake, env.GAME_TZ);
  await db.saveSleep(env.DB, player.id, { day, bed_at: bed.toISOString(), wake_at: wake.toISOString(), minutes });
  const r = db.rules(env);
  const target = r.sleepTargetMinutes;
  const verdict =
    minutes >= target ? "Sleep goal hit ✅" : `${prettyDuration(target - minutes)} short of the ${prettyDuration(target)} target ❌`;
  return `Logged ${prettyDuration(minutes)} of sleep (${prettyTime(bed.toISOString(), env.GAME_TZ)} to ${prettyTime(wake.toISOString(), env.GAME_TZ)}) for ${prettyDay(day)}. ${verdict} ${wakeLine(env, day, wake.toISOString())}`;
}

// ---------- meals ----------

export function mealTotals(meal: MealWithItems) {
  return meal.items.reduce(
    (t, i) => ({ calories: t.calories + i.calories, protein: t.protein + i.protein_g, fat: t.fat + i.fat_g, carbs: t.carbs + i.carbs_g }),
    { calories: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

// ---------- text summaries (for the agent and for Poke messages) ----------

export function goalLine(p: Player): string {
  if (!p.goal_type || p.calorie_target == null || p.protein_target == null) return "no goal set yet";
  const cmp = p.goal_type === "cut" ? "at most" : "at least";
  const extras = [
    p.fat_target != null && `fat at least ${p.fat_target}g`,
    p.carb_target != null && `carbs about ${p.carb_target}g`,
    p.sugar_target != null && `added sugar at most ${p.sugar_target}g`,
  ].filter(Boolean);
  const unscored = extras.length ? `, ${extras.join(", ")} (not scored)` : "";
  return `${p.goal_type}: ${cmp} ${p.calorie_target.toLocaleString()} cal, protein at least ${p.protein_target}g${unscored}`;
}

/** `final` = the day is over (recaps); otherwise a cut day under the floor is just "in progress". */
export function wakeLine(env: Env, day: string, wakeAt: string | null): string {
  const r = db.rules(env);
  const target = wakeTarget(day, r);
  const by = `up by ${prettyClock(target)}, ${r.wakeGraceMinutes} min grace`;
  if (wakeAt == null) return `⏰ no wake-up logged (${by})`;
  const late = wakeMinutes(wakeAt, r.tz) - target;
  return `⏰ up at ${prettyTime(wakeAt, r.tz)} ${late <= r.wakeGraceMinutes ? "✅" : `❌ (${late} min late; ${by})`}`;
}

export function statusLines(env: Env, p: Player, s: DayStats, day: string, opts: { final?: boolean } = {}): string[] {
  const { final = false } = opts;
  const r = db.rules(env);
  const lines: string[] = [];
  if (p.calorie_target != null && p.goal_type) {
    const ok = calorieGoalMet(p, s, r);
    const sign = p.goal_type === "cut" ? "≤" : "≥";
    const underFloor = p.goal_type === "cut" && s.calories < r.cutFloorCalories;
    let mark = ok ? " ✅" : " ❌";
    let note = "";
    if (s.foodCount === 0) note = " (nothing logged)";
    else if (s.unitemized) note = " (includes a total with no foods, so calories and protein don't count)";
    else if (p.goal_type === "cut" && s.calories > p.calorie_target) note = ` (${(s.calories - p.calorie_target).toLocaleString()} over${ok ? `, within the ${r.calorieGrace} cal grace` : ""})`;
    else if (underFloor && final) note = ` (under the ${r.cutFloorCalories.toLocaleString()} floor)`;
    else if (p.goal_type === "cut") note = ` (${(p.calorie_target - s.calories).toLocaleString()} left)`;
    else if (!ok) note = ` (${(p.calorie_target - s.calories).toLocaleString()} to go)`;
    if (underFloor && !final && s.foodCount > 0) mark = "";
    lines.push(`🔥 ${s.calories.toLocaleString()} / ${sign}${p.calorie_target.toLocaleString()} cal${mark}${note}`);
  } else {
    lines.push(`🔥 ${s.calories.toLocaleString()} cal`);
  }
  if (p.protein_target != null) {
    const ok = proteinGoalMet(p, s, r);
    lines.push(`💪 ${s.protein}g / ${p.protein_target}g protein ${ok ? "✅" : s.unitemized ? "❌ (doesn't count)" : `❌ (${Math.max(0, p.protein_target - s.protein)}g to go)`}`);
  } else {
    lines.push(`💪 ${s.protein}g protein`);
  }
  const fat = p.fat_target != null ? `${s.fat}g / ${p.fat_target}g fat${s.fat < p.fat_target ? " (low)" : ""}` : `${s.fat}g fat`;
  const carbs = p.carb_target != null ? `${s.carbs}g / ~${p.carb_target}g carbs` : `${s.carbs}g carbs`;
  lines.push(`🥑 ${fat} · 🍞 ${carbs}`);
  if (p.sugar_target != null) lines.push(sugarLine(p, s));
  lines.push(
    s.sleepMinutes != null
      ? `😴 ${prettyDuration(s.sleepMinutes)} sleep ${sleepGoalMet(s, r) ? "✅" : "❌"}`
      : "😴 no sleep logged",
  );
  lines.push(wakeLine(env, day, s.wakeAt));
  return lines;
}

export async function dayStats(env: Env, playerId: number, day: string): Promise<DayStats> {
  return (await db.statsForRange(env.DB, playerId, day, day)).get(day) ?? { ...EMPTY_DAY };
}

export type GoalKey = (typeof GOAL_KEYS)[number];
export const GOAL_NAMES: Record<GoalKey, string> = { cal: "Calories", protein: "Protein", sleep: "Sleep", wake: "Up on time" };

export interface WeekGoals {
  start: string;
  days: string[];
  status: (DayStatus | null)[]; // null for days in the future or before tracking started
  /** Days each goal was hit, out of the days it can be judged (logged and finished, or already hit today). */
  counts: Record<GoalKey, { hit: number; of: number }>;
}

/** The first day that counts (settings "start_day"), or null to count everything. */
export async function trackingStart(env: Env): Promise<string | null> {
  return db.getSetting(env.DB, "start_day");
}

/** Each goal's status for every day of a Monday-to-Sunday week, up to and including `today`. */
export async function weekGoals(env: Env, player: Player, start: string, today: string): Promise<WeekGoals> {
  const from = (await trackingStart(env)) ?? "";
  const days = weekDays(start);
  const r = db.rules(env);
  const stats = await db.statsForRange(env.DB, player.id, start, days[6]);
  const status = days.map((day) => (day > today || day < from ? null : dayStatus(player, stats.get(day) ?? EMPTY_DAY, r, day, today)));
  const counts = Object.fromEntries(GOAL_KEYS.map((k) => [k, { hit: 0, of: 0 }])) as WeekGoals["counts"];
  for (const st of status) {
    if (!st) continue;
    for (const k of GOAL_KEYS) {
      if (st[k] === "none" || st[k] === "now") continue;
      counts[k].of++;
      if (st[k] === "hit") counts[k].hit++;
    }
  }
  return { start, days, status, counts };
}

export function weekLine(w: WeekGoals): string {
  return GOAL_KEYS.map((k) => `${GOAL_NAMES[k]} ${w.counts[k].of ? `${w.counts[k].hit}/${w.counts[k].of}` : "–"}`).join(" · ");
}

/** Days in a row each goal was hit, counting back from today (today only counts once it's hit). */
export async function goalStreaks(env: Env, player: Player, today: string): Promise<Record<GoalKey, number>> {
  const from = (await trackingStart(env)) ?? "";
  const r = db.rules(env);
  const stats = await db.statsForRange(env.DB, player.id, addDays(today, -90), today);
  const out = {} as Record<GoalKey, number>;
  for (const k of GOAL_KEYS) {
    let n = 0;
    for (let d = today; d >= from && d >= addDays(today, -90); d = addDays(d, -1)) {
      const st = dayStatus(player, stats.get(d) ?? EMPTY_DAY, r, d, today)[k];
      if (d === today && st !== "hit") continue;
      if (st !== "hit") break;
      n++;
    }
    out[k] = n;
  }
  return out;
}

export interface Averages {
  sleepMinutes: number | null;
  wakeMinutes: number | null;
  calories: number | null;
  protein: number | null;
}

/** Averages over the seven finished days before today, from the days that have each thing logged. */
export async function lastWeekAverages(env: Env, player: Player, today: string): Promise<Averages> {
  const stats = [...(await db.statsForRange(env.DB, player.id, addDays(today, -7), addDays(today, -1))).values()];
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const fed = stats.filter((s) => s.foodCount > 0 && !s.unitemized);
  return {
    sleepMinutes: avg(stats.flatMap((s) => (s.sleepMinutes == null ? [] : [s.sleepMinutes]))),
    wakeMinutes: avg(stats.flatMap((s) => (s.wakeAt == null ? [] : [wakeMinutes(s.wakeAt, env.GAME_TZ)]))),
    calories: avg(fed.map((s) => s.calories)),
    protein: avg(fed.map((s) => s.protein)),
  };
}

// ---------- sentences (the journal-style lines on the page) ----------

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const FULL_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const clockOf = (iso: string, tz: string) => prettyTime(iso, tz).replace(/ (AM|PM)$/, "");
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

function gap(minutes: number): string {
  if (minutes === 60) return "an hour";
  if (minutes < 60) return `${minutes} minutes`;
  return minutes % 60 === 0 ? `${NUMBER_WORDS[minutes / 60] ?? minutes / 60} hours` : prettyDuration(minutes);
}

/** "You slept nine hours, 12:30 to 9:30, and were up an hour before the deadline. 460 calories left and 34 g of protein to go." */
export function todaySentence(env: Env, p: Player, s: DayStats, day: string): string {
  const r = db.rules(env);
  const out: string[] = [];
  let wake = "";
  if (s.wakeAt) {
    const late = wakeMinutes(s.wakeAt, r.tz) - wakeTarget(day, r);
    wake =
      late <= -15 ? `were up ${gap(-late)} before the deadline`
      : late <= 0 ? "were up right on time"
      : late <= r.wakeGraceMinutes ? "were up just in time"
      : `were up ${gap(late)} late`;
  }
  if (s.sleepMinutes != null) {
    const dur = s.sleepMinutes % 60 === 0 ? `${NUMBER_WORDS[s.sleepMinutes / 60] ?? s.sleepMinutes / 60} hours` : prettyDuration(s.sleepMinutes);
    const span = s.bedAt && s.wakeAt ? `, ${clockOf(s.bedAt, r.tz)} to ${clockOf(s.wakeAt, r.tz)}` : "";
    out.push(`You slept ${dur}${span}${wake ? `, and ${wake}` : ""}.`);
  } else if (s.wakeAt) {
    out.push(`You ${wake}, at ${clockOf(s.wakeAt, r.tz)}. No sleep logged.`);
  } else {
    out.push("No sleep logged yet.");
  }
  if (s.foodCount === 0) {
    out.push("Nothing eaten logged yet.");
  } else if (p.calorie_target != null && p.protein_target != null && p.goal_type) {
    const left = p.calorie_target - s.calories;
    const cal =
      p.goal_type === "cut" ? (left >= 0 ? `${fmt(left)} calories left` : `${fmt(-left)} calories over the limit`)
      : left > 0 ? `${fmt(left)} calories to go` : "calories done";
    const pLeft = p.protein_target - s.protein;
    const pro = pLeft > 0 ? `${pLeft} g of protein to go` : "protein done";
    out.push(`${cal[0].toUpperCase()}${cal.slice(1)} and ${pro}.`);
  } else {
    out.push(`${fmt(s.calories)} calories and ${s.protein} g of protein so far.`);
  }
  return out.join(" ");
}

/** A few lines on the week: streaks worth noticing, and why a blank day isn't a miss. */
export function weekNotes(w: WeekGoals, streaks: Record<GoalKey, number>, today: string): string {
  const out: string[] = [];
  const runs = [
    streaks.sleep >= 2 && `sleep has been on target ${streaks.sleep} nights running`,
    streaks.wake >= 2 && `you've been up on time ${streaks.wake} days in a row`,
    streaks.protein >= 2 && `protein's been hit ${streaks.protein} days running`,
    streaks.cal >= 2 && `calories have been on target ${streaks.cal} days running`,
  ].filter((x): x is string => Boolean(x)).slice(0, 2);
  if (runs.length) {
    const line = runs.join(", and ");
    out.push(`${line[0].toUpperCase()}${line.slice(1)}.`);
  }
  const blank = w.days.filter((d, i) => d < today && w.status[i]?.cal === "none").map((d) => FULL_DAYS[weekdayOf(d)]);
  if (blank.length) {
    out.push(`${listOf(blank)} ${blank.length > 1 ? "have" : "has"} no food logged, so ${blank.length > 1 ? "they're" : "it's"} left blank rather than counted against you.`);
  }
  return out.join(" ");
}

/** "Gym on Monday and Thursday, a run on Saturday. That's your goal two weeks in a row." */
export function gymSentence(p: Player, g: GymSummary, weekStartDay: string): string {
  const week = g.workouts.filter((w) => w.day >= weekStartDay && w.day <= addDays(weekStartDay, 6));
  if (!week.length) return p.workout_target ? `No workouts yet this week. Your goal is ${p.workout_target}.` : "No workouts yet this week.";
  const byKind = new Map<string, string[]>();
  for (const w of week) {
    const label = w.kind === "gym" ? "the gym" : w.kind === "run" ? "a run" : w.note ? w.note : "sport";
    const day = FULL_DAYS[weekdayOf(w.day)];
    const list = byKind.get(label) ?? [];
    if (!list.includes(day)) list.push(day);
    byKind.set(label, list);
  }
  const what = [...byKind].map(([label, days]) => `${label} on ${listOf(days)}`).join(", ");
  let goal = "";
  if (p.workout_target) {
    goal =
      g.thisWeek < p.workout_target ? ` ${p.workout_target - g.thisWeek} more for your goal of ${p.workout_target}.`
      : g.streak >= 2 ? ` That's your goal ${NUMBER_WORDS[g.streak] ?? g.streak} weeks in a row.`
      : " That's your goal for the week.";
  }
  return `${what[0].toUpperCase()}${what.slice(1)}.${goal}`;
}

/** Everything the agent needs to answer questions and pick the right ids. */
export async function statusReport(env: Env, player: Player, now: Date, offset: string, pageUrl: string): Promise<string> {
  const tz = env.GAME_TZ;
  const today = gameDay(now, tz);
  const p = localParts(now, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  const localIso = `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}${offset}`;

  const [meals, yesterdayMeals, week, weights, stats, gym] = await Promise.all([
    db.mealsForDay(env.DB, player.id, today),
    db.mealsForDay(env.DB, player.id, addDays(today, -1)),
    weekGoals(env, player, weekStart(today), today),
    db.weightsForPlayer(env.DB, player.id),
    dayStats(env, player.id, today),
    gymSummary(env, player, today),
  ]);
  const r = db.rules(env);

  const mealLines = (list: MealWithItems[]) =>
    list.length === 0
      ? ["  (none)"]
      : list.flatMap((m) => [
          `  Meal ${m.id}${m.name ? ` "${m.name}"` : ""}`,
          ...m.items.map((i) => `    item ${i.id}: ${i.description}: ${i.calories} cal, ${i.protein_g}g P, ${i.fat_g}g F, ${i.carbs_g}g C`),
        ]);

  const lastWeight = weights.at(-1);
  const lines = [
    `Now: ${localIso} (${tz}). Day: ${today} (${prettyDay(today)}). Days roll over at 4am.`,
    `Goal: ${goalLine(player)}. Sleep target: ${prettyDuration(r.sleepTargetMinutes)}. Wake-up: by ${prettyClock(r.wakeWeekday)} weekdays, ${prettyClock(r.wakeWeekend)} Sat/Sun, ${r.wakeGraceMinutes} min grace.`,
    ...statusLines(env, player, stats, today).map((l) => `  ${l}`),
    `  ${gymLine(player, gym)}. Gym is tracked for consistency only, not scored.`,
    player.pending_bed_at ? `In bed since ${prettyTime(player.pending_bed_at, tz)}; hasn't logged waking up.` : "",
    lastWeight
      ? `Latest weight: ${lastWeight.lb} lb on ${lastWeight.day}${player.goal_weight_lb ? `, goal ${player.goal_weight_lb} lb` : ""}.`
      : "",
    "",
    "Today's meals:",
    ...mealLines(meals),
    `Yesterday's meals (${addDays(today, -1)}):`,
    ...mealLines(yesterdayMeals),
    "",
    `This week (Mon to today, days each goal was hit out of days it can be judged): ${weekLine(week)}`,
    `${player.name}'s page (don't share the link): ${pageUrl}`,
  ];
  return lines.filter((l, i) => l !== "" || lines[i - 1] !== "").join("\n");
}

export interface GymSummary {
  today: string;
  workouts: Workout[];
  thisWeek: number;
  streak: number;
  total: number;
}

/** Workouts since tracking started (or ever, if it has no start date). */
export async function gymSummary(env: Env, player: Player, today: string): Promise<GymSummary> {
  const from = (await trackingStart(env)) ?? "0000-00-00";
  const workouts = await db.workoutsForPlayer(env.DB, player.id, from);
  const days = countByDay(workouts.map((w) => w.day));
  return {
    today,
    workouts,
    thisWeek: weekCount(days, today),
    streak: weekStreak(days, player.workout_target, from === "0000-00-00" ? (workouts[0]?.day ?? today) : from, today),
    total: workouts.length,
  };
}

export function gymLine(p: Player, g: GymSummary): string {
  const target = p.workout_target ? ` / ${p.workout_target} target` : " (no weekly target set)";
  const streak = p.workout_target ? `, streak ${g.streak} week${g.streak === 1 ? "" : "s"}` : "";
  const today = g.workouts.filter((w) => w.day === g.today);
  const logged = today.length ? `; today: ${today.map((w) => `${w.kind}${w.note ? ` (${w.note})` : ""}`).join(", ")}` : "; none logged today";
  return `🏋️ ${g.thisWeek} workout${g.thisWeek === 1 ? "" : "s"} this week${target}${streak}, ${g.total} total${logged}`;
}

/** Total sugar and the added part against the limit. */
export function sugarLine(p: Player, s: DayStats): string {
  if (s.sugar == null) return `🍬 no sugar estimates yet today (added sugar max ${p.sugar_target}g)`;
  const added = s.addedSugar ?? 0;
  const over = p.sugar_target != null && added > p.sugar_target;
  return `🍬 ${s.sugar}g sugar: ${added}g added / ${p.sugar_target}g max${over ? " (over)" : ""}, ${s.sugar - added}g natural`;
}

/** Short version for the end of tool results. */
export async function totalsLine(env: Env, player: Player, day: string): Promise<string> {
  return `${player.name}'s totals for ${prettyDay(day)}: ${statusLines(env, player, await dayStats(env, player.id, day), day).join(" | ")}`;
}

export async function dayRecap(env: Env, player: Player, day: string): Promise<string> {
  const s = await dayStats(env, player.id, day);
  const sc = scoreDay(player, s, db.rules(env), day);
  const hit = [sc.calOk, sc.proteinOk, sc.sleepOk, sc.wakeOk].filter(Boolean).length;
  return [`📋 ${prettyDay(day)}: ${hit} of 4 goals`, ...statusLines(env, player, s, day, { final: true })].join("\n");
}

/** Monday morning: how often each goal was hit last week, and workouts. */
export async function weekSummary(env: Env, player: Player, start: string): Promise<string> {
  const end = addDays(start, 6);
  const [week, gym] = await Promise.all([weekGoals(env, player, start, end), gymSummary(env, player, end)]);
  const notes = weekNotes(week, await goalStreaks(env, player, end), addDays(end, 1));
  return [
    `🏁 Week of ${prettyDay(start)}`,
    weekLine(week),
    notes,
    `🏋️ ${gymSentence(player, gym, start)}`,
  ].filter(Boolean).join("\n");
}

/** The daily carb minimum the brain needs (the National Academies' RDA). */
export const MIN_CARBS = 130;

export async function eveningNudge(env: Env, player: Player, day: string): Promise<string> {
  const s = await dayStats(env, player.id, day);
  const lines = [`🌙 9pm check-in for ${player.name}`, ...statusLines(env, player, s, day)];
  if (player.fat_target != null && s.fat < player.fat_target) {
    lines.push(`Fat is low (${s.fat}g of ${player.fat_target}g). Nut butter, avocado, or olive oil would close it.`);
  }
  if (player.sugar_target != null && (s.addedSugar ?? 0) > player.sugar_target) {
    lines.push(`Added sugar is over today (${s.addedSugar}g of ${player.sugar_target}g). Fruit or plain yogurt if you want something sweet; their sugar is natural.`);
  }
  if (player.carb_target != null && s.carbs < MIN_CARBS) {
    lines.push(`Carbs are low (${s.carbs}g; aim for about ${player.carb_target}g, and at least ${MIN_CARBS}g). Rice, oats, fruit, or potatoes would help.`);
  }
  if (player.protein_target != null && s.protein < player.protein_target) {
    lines.push(`${player.protein_target - s.protein}g protein to go. Greek yogurt, cottage cheese, or egg whites are easy wins.`);
  }
  const r = db.rules(env);
  const tomorrow = addDays(day, 1);
  lines.push(
    `Tomorrow (${prettyDay(tomorrow)}): up by ${prettyClock(wakeTarget(tomorrow, r))} for the wake-up goal. Text gm when you get up.`,
  );
  return lines.join("\n");
}
