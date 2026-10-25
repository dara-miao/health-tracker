import { describe, expect, it } from "vitest";
import { goalLine, statusLines, sugarLine, wakeLine } from "../src/game";
import type { Env, Player } from "../src/db";

const env = {
  GAME_TZ: "America/Los_Angeles", SLEEP_TARGET_HOURS: "7", CUT_FLOOR_CALORIES: "1200",
  WAKE_WEEKDAY: "08:30", WAKE_WEEKEND: "10:30", WAKE_GRACE_MINUTES: "10",
} as Env;
const dara: Player = {
  id: 1, name: "Dara", poke_api_key: null, goal_type: "cut", calorie_target: 1700, protein_target: 120,
  fat_target: 45, carb_target: 170, workout_target: 2, sugar_target: null, goal_weight_lb: 120, pending_bed_at: null,
};
const stats = (calories: number) => ({ calories, protein: 50, fat: 20, carbs: 100, foodCount: 2, sleepMinutes: null, wakeAt: null });

describe("statusLines", () => {
  it("doesn't mark a cut day under the floor as failed while it's still going", () => {
    expect(statusLines(env, dara, stats(458), "2026-09-30")[0]).toBe("🔥 458 / ≤1,700 cal (1,242 left)");
  });
  it("does in the final recap", () => {
    expect(statusLines(env, dara, stats(900), "2026-09-30", { final: true })[0]).toBe("🔥 900 / ≤1,700 cal ❌ (under the 1,200 floor)");
  });
  it("lists the unscored aims in the goal", () => {
    expect(goalLine(dara)).toMatch(/fat at least 45g, carbs about 170g/);
  });
  it("flags low fat", () => {
    expect(statusLines(env, dara, stats(1500), "2026-09-30")[2]).toBe("🥑 20g / 45g fat (low) · 🍞 100g / ~170g carbs");
  });
});

describe("wakeLine", () => {
  it("shows on time, late, and missing", () => {
    expect(wakeLine(env, "2026-09-30", "2026-09-30T15:22:00Z")).toBe("⏰ up at 8:22 AM ✅");
    expect(wakeLine(env, "2026-09-30", "2026-09-30T16:05:00Z")).toBe("⏰ up at 9:05 AM ❌ (35 min late; up by 8:30 AM, 10 min grace)");
    expect(wakeLine(env, "2026-10-03", null)).toBe("⏰ no wake-up logged (up by 10:30 AM, 10 min grace)");
  });
});

describe("sugar", () => {
  const tracking = { ...dara, sugar_target: 25 };
  it("splits added and natural, and flags going over", () => {
    expect(sugarLine(tracking, { ...stats(1500), sugar: 40, addedSugar: 30 })).toBe("🍬 40g sugar: 30g added / 25g max (over), 10g natural");
  });
  it("only shows when it's tracked", () => {
    const s = { ...stats(1500), sugar: 20, addedSugar: 5 };
    expect(statusLines(env, dara, s, "2026-09-30").join("\n")).not.toMatch(/sugar/);
    expect(statusLines(env, tracking, s, "2026-09-30").join("\n")).toMatch(/5g added/);
    expect(goalLine(tracking)).toMatch(/added sugar at most 25g/);
  });
});
