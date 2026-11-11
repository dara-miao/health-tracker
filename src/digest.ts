// Eating close to bed: how long before bedtime the last meal was, and whether nights after a late
// meal look different from nights after an early one. Pure functions, so the page, Poke and tests share them.
import { addDays, gameDay, localParts, prettyDuration } from "./time";

/** A late meal is one finished under this long before bed; an early one at least EARLY_MINUTES before. */
export const LATE_MINUTES = 2 * 60;
export const EARLY_MINUTES = 3 * 60;
/** Nights needed on each side before comparing, so one bad night doesn't make a pattern. */
export const MIN_NIGHTS = 3;
/** A difference in average sleep smaller than this is called no clear difference. */
export const MIN_DIFF_MINUTES = 15;

export interface MealTime {
  day: string; // game day the meal counts toward
  eaten_at: string | null; // ISO, when they said they ate it
  created_at: string; // SQLite "YYYY-MM-DD HH:MM:SS" in UTC, when it was logged
}

export interface SleepNight {
  day: string; // the day they woke up on
  bed_at: string; // ISO
  minutes: number;
}

export interface Night {
  day: string; // the day they woke up on, like sleep entries
  bedAt: string;
  lastAteAt: string;
  gapMinutes: number; // last meal to bed
  sleepMinutes: number;
}

/**
 * When a meal was eaten: the time given when it was logged, or else when it was logged, as long as that
 * was on the meal's own day. A meal backdated without a time ("yesterday I forgot...") has no usable time.
 */
export function mealTime(m: MealTime, tz: string): string | null {
  if (m.eaten_at) return m.eaten_at;
  const logged = new Date(`${m.created_at.replace(" ", "T")}Z`);
  if (Number.isNaN(logged.getTime())) return null;
  return gameDay(logged, tz) === m.day ? logged.toISOString() : null;
}

/**
 * Pairs each night of sleep with the last meal before it. The food day before a night is the day before
 * the wake-up day (days roll over at 4am, so a 1am bedtime still belongs to it). Only meals eaten before
 * bedtime count; a night with none is left out instead of guessed at.
 */
export function nights(meals: MealTime[], sleeps: SleepNight[], tz: string): Night[] {
  const byDay = new Map<string, number[]>();
  for (const m of meals) {
    const at = mealTime(m, tz);
    if (!at) continue;
    if (!byDay.has(m.day)) byDay.set(m.day, []);
    byDay.get(m.day)!.push(Date.parse(at));
  }
  const out: Night[] = [];
  for (const s of sleeps) {
    const bed = Date.parse(s.bed_at);
    const before = (byDay.get(addDays(s.day, -1)) ?? []).filter((t) => t <= bed);
    if (!before.length) continue;
    const last = Math.max(...before);
    out.push({ day: s.day, bedAt: s.bed_at, lastAteAt: new Date(last).toISOString(), gapMinutes: Math.round((bed - last) / 60000), sleepMinutes: s.minutes });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

export interface DigestInsight {
  late: number; // nights with a late last meal
  early: number;
  lateSleep: number | null; // average minutes slept after a late meal
  earlySleep: number | null;
  avgGap: number | null; // average minutes from last meal to bed, over every night
  text: string; // one or two sentences for the page and for Poke
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** "2h 10m" without a leading zero hour: "45m" */
export function gapWords(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return prettyDuration(minutes).replace(/ 00m$/, "");
}

/** Compares sleep after late meals with sleep after early ones. */
export function digestInsight(ns: Night[]): DigestInsight {
  const late = ns.filter((n) => n.gapMinutes < LATE_MINUTES);
  const early = ns.filter((n) => n.gapMinutes >= EARLY_MINUTES);
  const lateSleep = avg(late.map((n) => n.sleepMinutes));
  const earlySleep = avg(early.map((n) => n.sleepMinutes));
  const avgGap = avg(ns.map((n) => n.gapMinutes));
  const base = { late: late.length, early: early.length, lateSleep, earlySleep, avgGap };

  if (ns.length === 0) {
    return { ...base, text: "Nothing to compare yet. Once a few nights have both a logged dinner or snack and a bedtime, this shows whether eating late changes your sleep." };
  }
  const usual = `You usually stop eating ${gapWords(avgGap!)} before bed.`;
  if (late.length < MIN_NIGHTS || early.length < MIN_NIGHTS) {
    const need = late.length < MIN_NIGHTS && early.length < MIN_NIGHTS ? "both" : late.length < MIN_NIGHTS ? "late" : "early";
    const what =
      need === "both" ? `at least ${MIN_NIGHTS} nights each of eating within 2 hours of bed and of stopping 3+ hours before`
      : need === "late" ? `${MIN_NIGHTS - late.length} more night${MIN_NIGHTS - late.length === 1 ? "" : "s"} of eating within 2 hours of bed`
      : `${MIN_NIGHTS - early.length} more night${MIN_NIGHTS - early.length === 1 ? "" : "s"} of stopping 3+ hours before bed`;
    return { ...base, text: `${usual} To compare, it needs ${what}.` };
  }
  const diff = earlySleep! - lateSleep!;
  const facts = `After eating within 2 hours of bed you slept ${prettyDuration(lateSleep!)} on average (${late.length} nights), vs ${prettyDuration(earlySleep!)} when you stopped 3+ hours before (${early.length} nights).`;
  if (Math.abs(diff) < MIN_DIFF_MINUTES) return { ...base, text: `${facts} No clear difference for you so far.` };
  if (diff > 0) return { ...base, text: `${facts} That's ${gapWords(diff)} less sleep on late-eating nights, so an earlier last meal looks worth trying.` };
  return { ...base, text: `${facts} You've actually slept ${gapWords(-diff)} longer after late meals, so eating late doesn't seem to cost you sleep.` };
}

/** "9:40pm" */
export function clock(iso: string, tz: string): string {
  const p = localParts(new Date(iso), tz);
  return `${p.hour % 12 || 12}:${String(p.minute).padStart(2, "0")}${p.hour < 12 ? "am" : "pm"}`;
}
