import { describe, expect, it } from "vitest";
import { countByDay, weekCount, weekStreak } from "../src/gym";

// Weeks run Monday to Sunday. 2026-10-05 is a Monday.
const days = (...d: string[]) => countByDay(d);

describe("weekCount", () => {
  it("counts workouts in the Monday-to-Sunday week", () => {
    expect(weekCount(days("2026-10-04", "2026-10-05", "2026-10-11", "2026-10-12"), "2026-10-08")).toBe(2);
  });
});

describe("two workouts in a day", () => {
  it("count as two toward the week", () => {
    expect(weekCount(days("2026-10-06", "2026-10-06"), "2026-10-06")).toBe(2);
    expect(weekStreak(days("2026-10-06", "2026-10-06"), 2, "2026-10-03", "2026-10-07")).toBe(1);
  });
});

describe("weekStreak", () => {
  const from = "2026-10-03";
  const log = days("2026-10-03", "2026-10-04", "2026-10-06", "2026-10-08", "2026-10-13", "2026-10-15");
  it("counts consecutive weeks that hit the target", () => {
    expect(weekStreak(log, 2, from, "2026-10-18")).toBe(3);
  });
  it("doesn't break on a current week that's still in progress", () => {
    expect(weekStreak(log, 2, from, "2026-10-19")).toBe(3);
  });
  it("breaks after a full week under target", () => {
    expect(weekStreak(log, 2, from, "2026-10-26")).toBe(0);
  });
  it("is zero with no target", () => {
    expect(weekStreak(log, null, from, "2026-10-18")).toBe(0);
  });
});
