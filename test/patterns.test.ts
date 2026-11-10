import { describe, expect, it } from "vitest";
import { foodName, patterns, type LoggedFood } from "../src/patterns";
import type { Player } from "../src/db";

const me: Player = {
  id: 1, name: "Dara", poke_api_key: null, goal_type: "cut", calorie_target: 1500, protein_target: 110,
  fat_target: 45, carb_target: 170, workout_target: 3, sugar_target: 20, fiber_target: 25, sodium_target: 1900,
  iron_target: 18, water_target: 70, goal_weight_lb: null, pending_bed_at: null,
};
const day = (n: number) => `2026-11-0${n}`;
const food = (d: string, description: string, sodium_mg: number, iron_mg: number): LoggedFood => ({ day: d, description, sodium_mg, iron_mg, fiber_g: 0, added_sugar_g: 0 });

describe("foodName", () => {
  it("groups the same food logged different ways", () => {
    expect(foodName("1/2 cup lowfat cottage cheese (Good Culture)")).toBe("cottage cheese");
    expect(foodName("1 scoop whey in water")).toBe("protein shakes");
    expect(foodName("Fairlife Core Power shake")).toBe("protein shakes");
    expect(foodName("1 cup nonfat Greek yogurt with berries")).toBe("Greek yogurt");
    expect(foodName("2 large eggs scrambled")).toBe("eggs");
    expect(foodName("1/4 tsp Lawry's seasoned salt")).toBe("salty seasoning");
    expect(foodName("3 oz grilled shrimp")).toBe("grilled shrimp");
  });
});

describe("patterns", () => {
  // A week of the same staples: lots of sodium from cottage cheese, almost no iron.
  const foods = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => [
    food(day(n), "1 cup cottage cheese", 900, 0.2),
    food(day(n), "Greek yogurt with berries", 80, 0.1),
    food(day(n), "protein shake", 150, 0.5 - 0.1),
    food(day(n), "can of tuna", 300, 1.1),
    food(day(n), "1/4 tsp seasoned salt", 400, 0),
  ]);
  const days = [1, 2, 3, 4, 5, 6, 7].map(() => ({ calories: 1400, protein: 115, fat: 40, carbs: 100, foodCount: 5, fiber: 6, iron: 2, sodium: 1830 + 400, addedSugar: 5, water: 60, sleepMinutes: null, wakeAt: null }));
  const out = patterns(me, days, foods);

  it("leads with what's furthest off, and names their own foods", () => {
    expect(out).toHaveLength(3);
    expect(out[0]).toMatch(/^Iron has averaged 2 mg a day over the last 7 days, against 18\. Your go-tos \(cottage cheese, Greek yogurt, and protein shakes\) have almost none\./);
    expect(out[0]).toMatch(/add lentils, lean beef, and spinach/);
    expect(out.join(" ")).toMatch(/Fiber has averaged 6 g/);
    expect(out.join(" ")).toMatch(/same 5 foods/);
  });
  it("names the biggest sodium sources with a swap", () => {
    const sodium = patterns({ ...me, iron_target: null, fiber_target: null }, days, foods).find((t) => t.startsWith("Sodium"))!;
    expect(sodium).toMatch(/Most of it is from cottage cheese and salty seasoning\. Try low-sodium or no-salt-added cottage cheese instead of regular cottage cheese/);
  });
  it("says nothing until there are a few days of food", () => {
    expect(patterns(me, days.slice(0, 2), foods)).toEqual([]);
  });
});
