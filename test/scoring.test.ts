import { describe, expect, it } from "vitest";
import { scoreDay, wakeGoalMet, type DayStats, type Goal, type Rules } from "../src/scoring";

const rules: Rules = {
  tz: "America/Los_Angeles",
  sleepTargetMinutes: 420,
  cutFloorCalories: 1200,
  wakeWeekday: 510, // 8:30
  wakeWeekend: 630, // 10:30
  wakeGraceMinutes: 10,
};
const cutter: Goal = { goal_type: "cut", calorie_target: 1700, protein_target: 120 };
const bulker: Goal = { goal_type: "bulk", calorie_target: 3000, protein_target: 155 };
const WED = "2026-09-30";
const SAT = "2026-10-03";
const day = (calories: number, protein: number, sleepMinutes: number | null, foodCount = 3, wakeAt: string | null = null): DayStats => ({
  calories, protein, fat: 0, carbs: 0, sleepMinutes, foodCount, wakeAt,
});
const up = (d: string, hm: string) => day(0, 0, 450, 0, new Date(`${d}T${hm}:00-07:00`).toISOString());

describe("scoreDay", () => {
  it("cut wins calories by staying under, bulk by going over", () => {
    expect(scoreDay(cutter, day(1650, 125, 430), rules, WED)).toMatchObject({ calOk: true, proteinOk: true, sleepOk: true, points: 3 });
    expect(scoreDay(bulker, day(3100, 140, 400), rules, WED)).toMatchObject({ calOk: true, proteinOk: false, sleepOk: false, points: 1 });
  });
  it("the target itself counts as hitting it", () => {
    expect(scoreDay(cutter, day(1700, 120, 420), rules, WED).points).toBe(3);
    expect(scoreDay(bulker, day(3000, 155, 420), rules, WED).points).toBe(3);
  });
  it("Dara's Sep 30 scores 1 of 4 at 1,700 / 120g (6h sleep, no wake-up logged)", () => {
    expect(scoreDay(cutter, day(2085, 125, 360), rules, WED)).toEqual({ calOk: false, proteinOk: true, sleepOk: false, wakeOk: false, points: 1 });
  });
  it("a perfect day is 4 points", () => {
    const s = { ...day(1650, 125, 450), wakeAt: new Date(`${WED}T08:20:00-07:00`).toISOString() };
    expect(scoreDay(cutter, s, rules, WED).points).toBe(4);
  });
  it("a cut day under the floor never earns the calorie point", () => {
    expect(scoreDay(cutter, day(1100, 120, null), rules, WED).calOk).toBe(false);
    expect(scoreDay(cutter, day(1200, 120, null), rules, WED).calOk).toBe(true);
  });
  it("logging nothing is not a free cut win", () => {
    expect(scoreDay(cutter, day(0, 0, 450, 0), rules, WED)).toMatchObject({ calOk: false, proteinOk: false, sleepOk: true, points: 1 });
  });
  it("sleep is a target, so both players can earn it", () => {
    expect(scoreDay(cutter, day(0, 0, 420, 0), rules, WED).sleepOk).toBe(true);
    expect(scoreDay(bulker, day(0, 0, 419, 0), rules, WED).sleepOk).toBe(false);
    expect(scoreDay(bulker, day(0, 0, null, 0), rules, WED).sleepOk).toBe(false);
  });
  it("no goal set means no food points", () => {
    const none: Goal = { goal_type: null, calorie_target: null, protein_target: null };
    expect(scoreDay(none, day(1000, 200, null), rules, WED).points).toBe(0);
  });
});

describe("wake-up point", () => {
  it("weekdays: up by 8:30 with 10 minutes of grace", () => {
    expect(wakeGoalMet(WED, up(WED, "07:55"), rules)).toBe(true);
    expect(wakeGoalMet(WED, up(WED, "08:40"), rules)).toBe(true);
    expect(wakeGoalMet(WED, up(WED, "08:41"), rules)).toBe(false);
  });
  it("weekends: up by 10:30 with 10 minutes of grace", () => {
    expect(wakeGoalMet(SAT, up(SAT, "10:40"), rules)).toBe(true);
    expect(wakeGoalMet(SAT, up(SAT, "10:41"), rules)).toBe(false);
    expect(wakeGoalMet("2026-10-04", up("2026-10-04", "10:15"), rules)).toBe(true); // Sunday
  });
  it("no gm means no wake-up point", () => {
    expect(wakeGoalMet(WED, day(0, 0, 450, 0, null), rules)).toBe(false);
  });
});

describe("break days", () => {
  it("use the weekend wake time on weekdays", async () => {
    const { breakDays } = await import("../src/db");
    const { wakeTarget } = await import("../src/scoring");
    const r = { tz: "America/Los_Angeles", sleepTargetMinutes: 420, cutFloorCalories: 1200, wakeWeekday: 510, wakeWeekend: 630, wakeGraceMinutes: 10, breakDays: breakDays("2026-10-08..2026-10-09, 2026-11-26") };
    expect(wakeTarget("2026-10-07", r)).toBe(510);
    expect(wakeTarget("2026-10-08", r)).toBe(630);
    expect(wakeTarget("2026-10-09", r)).toBe(630);
    expect(wakeTarget("2026-11-26", r)).toBe(630);
  });
});

describe("bare totals", () => {
  it("are recognized", async () => {
    const { looksUnitemized } = await import("../src/scoring");
    expect(looksUnitemized({ description: "Daily calorie and protein goal total (user reported hitting 3,000 cal and 155g+ protein; fat and carbs not provided)", calories: 3000, fat_g: 0, carbs_g: 0 })).toBe(true);
    expect(looksUnitemized({ description: "Calories (user-provided total; foods/macros unspecified)", calories: 900, fat_g: 0, carbs_g: 0 })).toBe(true);
    expect(looksUnitemized({ description: "1 Sweetgreen bowl, estimated", calories: 1200, fat_g: 62, carbs_g: 105 })).toBe(false);
    expect(looksUnitemized({ description: "Creatine supplement", calories: 0, fat_g: 0, carbs_g: 0 })).toBe(false);
    expect(looksUnitemized({ description: "1 cup egg whites", calories: 126, fat_g: 0, carbs_g: 2 })).toBe(false);
  });
  it("cost the calorie and protein points", async () => {
    const { calorieGoalMet, proteinGoalMet } = await import("../src/scoring");
    const bulker = { goal_type: "bulk" as const, calorie_target: 3000, protein_target: 155 };
    const s = { calories: 3000, protein: 155, fat: 0, carbs: 0, foodCount: 2, sleepMinutes: null, wakeAt: null };
    const r = { tz: "America/Los_Angeles", sleepTargetMinutes: 420, cutFloorCalories: 1200, wakeWeekday: 510, wakeWeekend: 630, wakeGraceMinutes: 10 };
    expect(calorieGoalMet(bulker, s, r) && proteinGoalMet(bulker, s)).toBe(true);
    expect(calorieGoalMet(bulker, { ...s, unitemized: 1 }, r) || proteinGoalMet(bulker, { ...s, unitemized: 1 })).toBe(false);
  });
});

describe("calorie and protein grace", () => {
  it("lets estimates land a little past the goal", async () => {
    const { calorieGoalMet, proteinGoalMet } = await import("../src/scoring");
    const r = { tz: "America/Los_Angeles", sleepTargetMinutes: 420, cutFloorCalories: 1200, wakeWeekday: 510, wakeWeekend: 630, wakeGraceMinutes: 10, calorieGrace: 50, proteinGrace: 5 };
    const day = (calories: number, protein = 0) => ({ calories, protein, fat: 0, carbs: 0, foodCount: 3, sleepMinutes: null, wakeAt: null });
    const cut = { goal_type: "cut" as const, calorie_target: 1700, protein_target: 120 };
    const bulk = { goal_type: "bulk" as const, calorie_target: 3000, protein_target: 155 };
    expect(calorieGoalMet(cut, day(1701), r)).toBe(true);
    expect(calorieGoalMet(cut, day(1750), r)).toBe(true);
    expect(calorieGoalMet(cut, day(1751), r)).toBe(false);
    expect(calorieGoalMet(bulk, day(2950), r)).toBe(true);
    expect(calorieGoalMet(bulk, day(2949), r)).toBe(false);
    expect(proteinGoalMet(cut, day(1500, 115), r)).toBe(true);
    expect(proteinGoalMet(cut, day(1500, 114), r)).toBe(false);
  });
});
