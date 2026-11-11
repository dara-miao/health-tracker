import { describe, expect, it } from "vitest";
import { digestInsight, mealTime, nights, type MealTime, type SleepNight } from "../src/digest";

const TZ = "America/Los_Angeles";
// Pacific times in November (PST, -08:00).
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00-08:00`).toISOString();
const sqlite = (iso: string) => iso.replace("T", " ").slice(0, 19);

describe("mealTime", () => {
  it("uses the time they ate it when given", () => {
    expect(mealTime({ day: "2026-11-10", eaten_at: at("2026-11-10", "19:00"), created_at: sqlite(at("2026-11-10", "22:00")) }, TZ)).toBe(at("2026-11-10", "19:00"));
  });
  it("falls back to when it was logged, on the meal's own day", () => {
    expect(mealTime({ day: "2026-11-10", eaten_at: null, created_at: sqlite(at("2026-11-10", "21:30")) }, TZ)).toBe(at("2026-11-10", "21:30"));
    // A 1am snack still belongs to the day before.
    expect(mealTime({ day: "2026-11-10", eaten_at: null, created_at: sqlite(at("2026-11-11", "01:00")) }, TZ)).toBe(at("2026-11-11", "01:00"));
  });
  it("has no time for a meal backdated without one", () => {
    expect(mealTime({ day: "2026-11-09", eaten_at: null, created_at: sqlite(at("2026-11-10", "12:00")) }, TZ)).toBeNull();
  });
});

describe("nights", () => {
  it("pairs each night with the last meal before bed on the day before waking", () => {
    const meals: MealTime[] = [
      { day: "2026-11-10", eaten_at: at("2026-11-10", "12:30"), created_at: "" },
      { day: "2026-11-10", eaten_at: at("2026-11-10", "20:15"), created_at: "" },
      { day: "2026-11-10", eaten_at: at("2026-11-11", "01:30"), created_at: "" }, // after bed: ignored
    ];
    const sleeps: SleepNight[] = [{ day: "2026-11-11", bed_at: at("2026-11-11", "00:15"), minutes: 450 }];
    expect(nights(meals, sleeps, TZ)).toEqual([{ day: "2026-11-11", bedAt: at("2026-11-11", "00:15"), lastAteAt: at("2026-11-10", "20:15"), gapMinutes: 240, sleepMinutes: 450 }]);
  });
  it("skips nights with no meal time", () => {
    expect(nights([], [{ day: "2026-11-11", bed_at: at("2026-11-11", "00:15"), minutes: 450 }], TZ)).toEqual([]);
  });
});

describe("digestInsight", () => {
  const night = (n: number, gapMinutes: number, sleepMinutes: number) => ({ day: `2026-11-${String(n).padStart(2, "0")}`, bedAt: "", lastAteAt: "", gapMinutes, sleepMinutes });

  it("waits for enough nights on both sides", () => {
    const i = digestInsight([night(1, 60, 400), night(2, 240, 450)]);
    expect(i.text).toMatch(/needs at least 3 nights each/);
    expect(i.text).toMatch(/usually stop eating 2h 30m before bed/);
  });
  it("says how much less they sleep after late meals", () => {
    const late = [1, 2, 3].map((n) => night(n, 45, 390));
    const early = [4, 5, 6].map((n) => night(n, 200, 450));
    const i = digestInsight([...late, ...early]);
    expect(i).toMatchObject({ late: 3, early: 3, lateSleep: 390, earlySleep: 450 });
    expect(i.text).toMatch(/slept 6h 30m on average \(3 nights\), vs 7h 30m/);
    expect(i.text).toMatch(/That's 1h less sleep on late-eating nights/);
  });
  it("calls a small difference no clear difference", () => {
    const i = digestInsight([...[1, 2, 3].map((n) => night(n, 60, 440)), ...[4, 5, 6].map((n) => night(n, 240, 445))]);
    expect(i.text).toMatch(/No clear difference/);
  });
  it("leaves the 2 to 3 hour middle out of both groups", () => {
    const i = digestInsight([night(1, 150, 300), night(2, 150, 300)]);
    expect(i).toMatchObject({ late: 0, early: 0 });
  });
});
