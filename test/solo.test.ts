import { describe, expect, it } from "vitest";
import { todaySentence, weekLine } from "../src/game";
import { dayStatus } from "../src/scoring";
import { mealSlot } from "../src/web";
import { handleMcp } from "../src/mcp";
import { sha256, type Env } from "../src/db";

describe("weekLine", () => {
  it("shows each goal's days hit out of days logged", () => {
    const counts = { cal: { hit: 3, of: 5 }, protein: { hit: 3, of: 5 }, sleep: { hit: 6, of: 7 }, wake: { hit: 0, of: 0 } };
    expect(weekLine({ start: "2026-10-19", days: [], status: [], counts })).toBe("Calories 3/5 · Protein 3/5 · Sleep 6/7 · Up on time –");
  });
});

describe("dayStatus", () => {
  const rules = { tz: "America/Los_Angeles", sleepTargetMinutes: 420, cutFloorCalories: 1200, wakeWeekday: 510, wakeWeekend: 630, wakeGraceMinutes: 10, calorieGrace: 50, proteinGrace: 5 };
  const cut = { goal_type: "cut" as const, calorie_target: 1700, protein_target: 120 };
  const day = (calories: number, protein: number, extra: object = {}) => ({ calories, protein, fat: 40, carbs: 150, foodCount: 3, sleepMinutes: null, wakeAt: null, ...extra });
  const WED = "2026-09-30";
  it("calls a finished day hit, close, or missed", () => {
    expect(dayStatus(cut, day(1600, 125), rules, WED, "2026-10-01")).toMatchObject({ cal: "hit", protein: "hit" });
    expect(dayStatus(cut, day(1840, 110), rules, WED, "2026-10-01")).toMatchObject({ cal: "near", protein: "near" });
    expect(dayStatus(cut, day(2200, 80), rules, WED, "2026-10-01")).toMatchObject({ cal: "miss", protein: "miss" });
  });
  it("leaves a day with nothing logged blank, not missed", () => {
    expect(dayStatus(cut, { ...day(0, 0), foodCount: 0 }, rules, WED, "2026-10-01")).toEqual({ cal: "none", protein: "none", sleep: "none", wake: "none" });
  });
  it("keeps today's food in progress until it's settled", () => {
    expect(dayStatus(cut, day(900, 60), rules, WED, WED)).toMatchObject({ cal: "now", protein: "now" });
    expect(dayStatus(cut, day(1300, 125), rules, WED, WED)).toMatchObject({ cal: "now", protein: "hit" });
    expect(dayStatus(cut, day(2300, 60), rules, WED, WED).cal).toBe("miss");
  });
  it("sleep and wake-up: close within 30 minutes", () => {
    const up = (hm: string) => new Date(`${WED}T${hm}:00-07:00`).toISOString();
    expect(dayStatus(cut, day(0, 0, { foodCount: 0, sleepMinutes: 400, wakeAt: up("08:55") }), rules, WED, WED)).toMatchObject({ sleep: "near", wake: "near" });
    expect(dayStatus(cut, day(0, 0, { foodCount: 0, sleepMinutes: 300, wakeAt: up("09:30") }), rules, WED, WED)).toMatchObject({ sleep: "miss", wake: "miss" });
  });
});

describe("mealSlot", () => {
  const tz = "America/Los_Angeles";
  it("keeps Breakfast, Lunch, Dinner, and Snack labels", () => {
    expect(mealSlot("breakfast", "2026-10-25 22:00:00", tz)).toBe("Breakfast");
    expect(mealSlot("Late-night snack", "2026-10-25 15:00:00", tz)).toBe("Snack");
  });
  it("names anything else by when it was logged", () => {
    expect(mealSlot("Chipotle bowl", "2026-10-25 19:30:00", tz)).toBe("Lunch"); // 12:30pm PDT
    expect(mealSlot(null, "2026-10-26 02:00:00", tz)).toBe("Dinner"); // 7pm PDT
    expect(mealSlot("Meal", "2026-10-25 15:10:00", tz)).toBe("Breakfast"); // 8:10am PDT
  });
});

describe("todaySentence", () => {
  const env = { GAME_TZ: "America/Los_Angeles", SLEEP_TARGET_HOURS: "7", CUT_FLOOR_CALORIES: "1200", WAKE_WEEKDAY: "08:30", WAKE_WEEKEND: "10:30", WAKE_GRACE_MINUTES: "10" } as Env;
  const p = { goal_type: "cut", calorie_target: 1700, protein_target: 120 } as any;
  it("reads like the journal line", () => {
    const s = { calories: 1240, protein: 86, fat: 30, carbs: 120, foodCount: 2, sleepMinutes: 540, bedAt: "2026-10-25T07:30:00Z", wakeAt: "2026-10-25T16:30:00Z" };
    expect(todaySentence(env, p, s, "2026-10-25")).toBe(
      "You slept nine hours, 12:30 to 9:30, and were up an hour before the deadline. 460 calories left and 34 g of protein to go.",
    );
  });
  it("handles an empty morning", () => {
    const s = { calories: 0, protein: 0, fat: 0, carbs: 0, foodCount: 0, sleepMinutes: null, wakeAt: null };
    expect(todaySentence(env, p, s, "2026-10-25")).toBe("No sleep logged yet. Nothing eaten logged yet.");
  });
});

describe("MCP access", () => {
  // A players table with the owner and one other player, looked up by key hash.
  async function envWith(owner: string) {
    const rows = [
      { id: 1, name: "Dara", hash: await sha256("hb_dara") },
      { id: 2, name: "Someone", hash: await sha256("hb_other") },
    ];
    const DB = {
      prepare: () => ({ bind: (hash: string) => ({ first: async () => rows.find((r) => r.hash === hash) ?? null }) }),
    } as unknown as D1Database;
    return { DB, OWNER_NAME: owner, GAME_TZ: "America/Los_Angeles" } as Env;
  }
  const ping = (key: string) =>
    new Request("https://x/mcp", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });

  it("lets the owner in", async () => {
    expect((await handleMcp(ping("hb_dara"), await envWith("Dara"))).status).toBe(200);
  });
  it("refuses any other player's key, and unknown keys", async () => {
    expect((await handleMcp(ping("hb_other"), await envWith("Dara"))).status).toBe(401);
    expect((await handleMcp(ping("hb_nope"), await envWith("Dara"))).status).toBe(401);
  });
});
