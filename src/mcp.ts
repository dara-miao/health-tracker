// A minimal MCP server (Streamable HTTP transport, JSON responses, stateless).
// The owner's agent (e.g. Poke) connects with their API key as a Bearer token.
// Any other key is refused.
import * as db from "./db";
import type { Env, FoodItem, Player } from "./db";
import { UserError, dayStats, goToBed, goalLine, gymLine, gymSummary, logNight, ironWaterLine, mealTotals, sodiumLine, statusReport, sugarLine, totalsLine, wakeUp } from "./game";
import { WORKOUT_KINDS, type WorkoutKind } from "./gym";
import { addDays, formatOffset, gameDay, parseTime, prettyDay, prettyTime, utcOffsetMinutes } from "./time";

const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `This is a personal health tracker (food, sleep, wake-up) with a gym consistency log. The person messaging you is its owner; log what they tell you.

Each day has five goals: calories (cut: stay at or under; bulk: reach at least), protein, sleeping at least the sleep target, getting up by the wake-up time (get_status shows it), and kitchen closed: the day's last meal at least 3 hours before that night's bedtime. There are no points; the app shows which goals were hit. Fat, carbs and workouts are tracked and shown but aren't goals.

- When they mention food they ate (or send a photo), estimate it and call log_food right away. Don't ask permission first. If they ate it a while ago, pass eaten_at so the app can compare late eating with sleep.
- Clarifying questions: if something they didn't specify would swing the estimate a lot (roughly 150+ calories or 15g+ protein: a portion of granola, nut butter, rice or pasta, a sauce or dressing, how it was cooked, which restaurant or brand), log your best guess first, then ask ONE short question with your assumption in it, e.g. "Logged the bowl assuming ⅓ cup granola. Was it more like ½ cup?" When they answer, fix that item with edit_food. Don't ask about small things (a handful of berries, a splash of milk), and don't ask more than one question per meal. If they don't answer, keep the guess.
- Sleep: any way of saying they're going to sleep ("gn", "going to bed", "night", "heading to sleep") means sleep_start. Any way of saying they woke up ("gm", "just woke up", "I'm up", "morning") means sleep_end. The wake-up time is a goal, so log it right away; if they say they got up earlier ("up since 8"), pass that time. A plain greeting like "hi" or "hey" is not a wake-up. But if get_status shows they're still in bed and it's morning, ask "Did you just wake up?" before logging, and use the time they confirm.
- Log foods, not totals. If they only give a number ("I hit 3000 today"), ask what they ate. A calorie number with no foods is saved but doesn't count toward the calorie or protein goal.
- Sugar: estimate sugar_g and added_sugar_g for every item, whether or not they track sugar. Added sugar is sugar put in during processing or cooking (sweets, soda, sweetened coffee drinks, flavored yogurt, granola, sauces, honey, syrup); sugar inside whole fruit, plain milk and plain yogurt is natural. Sugar isn't scored. When they ask to track it or change the limit ("track my sugar", "set my sugar limit to 21g"), call set_sugar_goal; to stop, call it with null.
- Fiber: estimate fiber_g for every item too. It's shown with fat and carbs, not one of the goals. When they ask for a fiber goal ("aim for 30g of fiber"), set_goal with fiber_target.
- Iron: estimate iron_mg for every item too (one decimal is fine: an egg ~0.9, 4 oz beef ~3, 1 cup cooked spinach ~6, 1 cup lentils ~6.6, most fortified cereal 8 to 18 per serving; dairy, whey and plain yogurt are ~0). If they take an iron supplement, don't log it as food. Iron isn't one of the goals. When they ask for an iron target, set_goal with iron_target.
- Water: when they mention drinking water ("drank a bottle", "had 2 glasses", "finished my 32oz"), call log_water right away with the ounces (a standard bottle is 16.9 oz, a glass 8 oz; ask once if a container's size is unclear, and remember it). Only plain water, sparkling water and unsweetened tea count; log other drinks as food. If one was logged by mistake, remove_water. When they set a daily amount ("aim for 80 oz"), set_goal with water_target.
- Sodium: estimate sodium_mg for every item too, whether or not they track it. Don't lowball restaurant food, sauces, soups, deli meat, bread, cheese (cottage cheese is high) and anything salted or cured; use the label or the chain's nutrition facts when known. Count salt and salty seasonings added while cooking or at the table (salt, seasoned salt and blends, Tajín, bouillon, soy sauce, hot sauce, seasoning packets) as their own item: 1/4 tsp of salt is about 575mg. Plain spices and salt-free blends (garlic or onion powder, pepper, paprika, cumin, chili flakes) have essentially none. If they track sodium and cooked something themselves without saying how they seasoned it, log a typical amount and ask which seasoning and roughly how much (this counts as the meal's one question if it's the biggest unknown). Sodium isn't one of the goals. When they ask to track it or change the limit ("track my sodium", "keep my sodium under 1900mg"), call set_sodium_goal; to stop, call it with null.
- Workouts: when they say they went to the gym, worked out, lifted, played a sport, or went for a run ("hit legs", "just got back from the gym", "played tennis", "ran 3 miles"), call log_workout right away, once per session. Two separate sessions in a day (gym in the morning, a run at night) are two log_workout calls. Don't log the same session twice: "heading to the gym" then "back from the gym" is one workout (log it when they say they went or are back), and get_status shows what's already logged today. If they say they didn't actually go, or one was logged by mistake, remove_workout. Workouts aren't scored; they fill in a GitHub-style consistency grid. When they set a weekly goal ("I want to go 3 times a week"), set_workout_target.
- Call get_status before answering questions about progress, and before editing or deleting so you have the right ids.
- Reply like a text message: short, plain text, with their running totals vs goals after each log.`;

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string", description: "Short label with the amount, e.g. '1 cup nonfat Greek yogurt'" },
    calories: { type: "number" },
    protein_g: { type: "number" },
    fat_g: { type: "number" },
    carbs_g: { type: "number" },
    sugar_g: { type: "number", description: "Total sugar, natural plus added." },
    fiber_g: { type: "number", description: "Dietary fiber in grams. Use the label when known; whole grains, beans, fruit, vegetables, nuts and seeds have the most." },
    added_sugar_g: {
      type: "number",
      description: "The part of sugar_g that's added (table sugar, syrups, honey, juice concentrate, sweets, sweetened drinks and sauces). Sugar naturally in whole fruit, plain milk and plain yogurt is not added. Use the label's 'Includes Xg Added Sugars' when known.",
    },
    iron_mg: { type: "number", description: "Iron in milligrams, one decimal is fine. Red meat, liver, shellfish, beans, lentils, tofu, spinach and fortified cereal have the most; dairy almost none." },
    sodium_mg: { type: "number", description: "Sodium in milligrams, including salt and salty seasoning. Use the label or the restaurant's nutrition facts when known." },
  },
  required: ["description", "calories", "protein_g", "fat_g", "carbs_g", "sugar_g", "added_sugar_g", "fiber_g", "sodium_mg", "iron_mg"],
};

function tools() {
  return [
  {
    name: "log_food",
    description: `Log food they ate, with your estimates of calories and macros for each item.
Estimating: use typical US portions unless they give amounts, and official nutrition facts for named chains and packaged products. Don't lowball: count cooking oil, butter, sauces, and dressings. Split a meal into its separate foods so each can be corrected later. If something is vague, log your best guess, say what you assumed, and if the guess could be off by a lot, ask one short question to pin it down (then edit_food with the answer).
Meals: leave meal_id null to start a new meal. Pass an existing meal_id (from get_status) when they're adding to something they just logged ("also had guac with that").`,
    inputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: ITEM_SCHEMA, minItems: 1 },
        meal_id: { type: ["integer", "null"], description: "Add to this existing meal instead of starting a new one." },
        meal_name: { type: ["string", "null"], enum: ["Breakfast", "Lunch", "Dinner", "Snack", null], description: "Which meal: Breakfast, Lunch, Dinner, or Snack, by when they ate it. Never a dish name; the items say what it was." },
        day: { type: ["string", "null"], description: "YYYY-MM-DD to backdate (e.g. 'yesterday I forgot...'). Null for today." },
        eaten_at: { type: ["string", "null"], description: "ISO 8601 time they ate it, when it wasn't just now ('had dinner at 7', 'a snack around 11pm last night'). Null if they're eating it now. Used to compare late eating with sleep." },
      },
      required: ["items"],
    },
  },
  {
    name: "set_meal_time",
    description: "Change when a logged meal was eaten ('that dinner was actually at 9:30'). Get the meal id from get_status.",
    inputSchema: {
      type: "object",
      properties: {
        meal_id: { type: "integer" },
        eaten_at: { type: "string", description: "ISO 8601" },
      },
      required: ["meal_id", "eaten_at"],
    },
  },
  {
    name: "edit_food",
    description: "Replace one logged food item with corrected values (e.g. 'actually it was 3 eggs'). Get the item id from get_status.",
    inputSchema: {
      type: "object",
      properties: { item_id: { type: "integer" }, ...ITEM_SCHEMA.properties },
      required: ["item_id", ...ITEM_SCHEMA.required],
    },
  },
  {
    name: "delete_food",
    description: "Delete logged food items by id (from get_status).",
    inputSchema: {
      type: "object",
      properties: { item_ids: { type: "array", items: { type: "integer" }, minItems: 1 } },
      required: ["item_ids"],
    },
  },
  {
    name: "sleep_start",
    description: "They're going to sleep. Leave 'at' null for now.",
    inputSchema: {
      type: "object",
      properties: { at: { type: ["string", "null"], description: "ISO 8601 time if not now." } },
    },
  },
  {
    name: "sleep_end",
    description: "They just woke up; records the night since sleep_start and their wake-up time (a goal if on time). Leave 'at' null for now.",
    inputSchema: {
      type: "object",
      properties: { at: { type: ["string", "null"], description: "ISO 8601 time if not now." } },
    },
  },
  {
    name: "log_sleep",
    description: "Record a whole night after the fact, e.g. 'slept 1am to 7am'. Use the date/offset from get_status.",
    inputSchema: {
      type: "object",
      properties: {
        bed_at: { type: "string", description: "ISO 8601" },
        wake_at: { type: "string", description: "ISO 8601" },
      },
      required: ["bed_at", "wake_at"],
    },
  },
  {
    name: "get_status",
    description:
      "The current time, their goals and totals for today, today's and yesterday's meals with ids, workouts, and this week's goals.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "set_goal",
    description: "Set the daily goal. Only when they ask to change it.",
    inputSchema: {
      type: "object",
      properties: {
        goal_type: { type: "string", enum: ["cut", "bulk"] },
        calorie_target: { type: "integer", description: "cut: the max; bulk: the min" },
        protein_target: { type: "integer", description: "minimum grams" },
        fat_target: { type: ["integer", "null"], description: "minimum grams, shown but not scored" },
        carb_target: { type: ["integer", "null"], description: "rough daily aim in grams, shown but not scored" },
        fiber_target: { type: ["integer", "null"], description: "daily fiber aim in grams, shown but not one of the goals" },
        iron_target: { type: ["integer", "null"], description: "daily iron aim in mg (18 for women 19 to 50), shown but not one of the goals" },
        water_target: { type: ["integer", "null"], description: "daily water aim in fl oz, shown but not one of the goals" },
      },
      required: ["goal_type", "calorie_target", "protein_target"],
    },
  },
  {
    name: "set_sodium_goal",
    description: "Turn on sodium tracking with a daily limit (not one of the goals), change the limit, or turn it off with null.",
    inputSchema: {
      type: "object",
      properties: { max_mg: { type: ["integer", "null"], minimum: 500, maximum: 10000, description: "Max milligrams of sodium a day. Use 1,900 unless they name a number (under the WHO's 2,000; 1,500 is the ideal intake and 2,300 the risk line to stay under). Null turns tracking off." } },
      required: ["max_mg"],
    },
  },
  {
    name: "log_weight",
    description: "Record a weigh-in in pounds. Optionally set a goal weight.",
    inputSchema: {
      type: "object",
      properties: {
        lb: { type: "number" },
        goal_weight_lb: { type: ["number", "null"], description: "Only if they mention a new goal weight." },
      },
      required: ["lb"],
    },
  },
  {
    name: "set_sugar_goal",
    description: "Turn on sugar tracking with a daily limit for added sugar (not scored), change the limit, or turn it off with null.",
    inputSchema: {
      type: "object",
      properties: { added_max_g: { type: ["integer", "null"], minimum: 1, maximum: 200, description: "Max grams of added sugar a day; 25 is the American Heart Association's limit for women, 36 for men. Null turns tracking off." } },
      required: ["added_max_g"],
    },
  },
  {
    name: "log_water",
    description: "Log water they drank, in fluid ounces. Call once per drink they mention. Not one of the goals.",
    inputSchema: {
      type: "object",
      properties: {
        oz: { type: "number", minimum: 1, maximum: 128, description: "Fluid ounces: a standard bottle is 16.9, a glass 8, a big tumbler 32 to 40. For mL, divide by 29.6." },
        day: { type: ["string", "null"], description: "YYYY-MM-DD to backdate. Null for today." },
      },
      required: ["oz"],
    },
  },
  {
    name: "remove_water",
    description: "Remove the most recent water logged on a day (logged by mistake).",
    inputSchema: { type: "object", properties: { day: { type: ["string", "null"], description: "YYYY-MM-DD. Null for today." } } },
  },
  {
    name: "log_workout",
    description: "Log one workout session on the consistency grid. Not scored. Call once per session; a day can have several.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["gym", "sport", "run"], description: "gym = lifting, classes, any gym session; sport = tennis, climbing, a game, etc.; run = a run" },
        note: { type: ["string", "null"], description: "Optional, a few words: 'legs', 'tennis', '5k'." },
        day: { type: ["string", "null"], description: "YYYY-MM-DD to backdate ('I went yesterday'). Null for today." },
      },
      required: ["kind"],
    },
  },
  {
    name: "remove_workout",
    description: "Remove the most recent workout logged on a day (logged by mistake, or they didn't actually go).",
    inputSchema: { type: "object", properties: { day: { type: ["string", "null"], description: "YYYY-MM-DD. Null for today." } } },
  },
  {
    name: "set_workout_target",
    description: "Set how many workouts a week they're aiming for. Their streak counts weeks that hit it.",
    inputSchema: { type: "object", properties: { per_week: { type: "integer", minimum: 1, maximum: 7 } }, required: ["per_week"] },
  },
];
}

type Args = Record<string, any>;

/** A YYYY-MM-DD day from an agent: today if null, clamped to today if ahead (UTC dates), at most `maxBack` days old. */
function pastDay(raw: unknown, today: string, maxBack: number): string {
  if (raw == null || raw === "") return today;
  const day = String(raw);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < addDays(today, -maxBack)) {
    throw new ToolError(`day must be YYYY-MM-DD, today or within the past ${maxBack} days.`);
  }
  return day > today ? today : day;
}

const ToolError = UserError;

function time(env: Env, iso: unknown, now: Date): Date {
  if (iso == null || iso === "") return now;
  const t = typeof iso === "string" ? parseTime(iso, env.GAME_TZ) : null;
  if (!t) throw new ToolError(`Couldn't read the time "${iso}". Use ISO 8601, e.g. 2026-10-01T23:30-07:00.`);
  return t;
}

const SUGAR_TAG = /\s*[\[(]\s*sugar\s*:?\s*(\d+(?:\.\d+)?)\s*g?\s*(?:[,;/·]\s*(?:added\s*:?\s*)?(\d+(?:\.\d+)?)\s*g?\s*(?:added)?)?\s*[\])]/i;

/** "1 cup vanilla yogurt [sugar 16g, 9g added]" -> the description without the tag, plus the numbers. */
export function parseSugarTag(description: string): { description: string; sugar_g: number | null; added_sugar_g: number | null } {
  const m = description.match(SUGAR_TAG);
  if (!m) return { description, sugar_g: null, added_sugar_g: null };
  return {
    description: description.replace(SUGAR_TAG, "").trim(),
    sugar_g: Number(m[1]),
    added_sugar_g: m[2] != null ? Number(m[2]) : null,
  };
}

const FIBER_TAG = /\s*[\[(]\s*fiber\s*:?\s*(\d+(?:\.\d+)?)\s*g?\s*[\])]/i;

/** "1 cup oatmeal [fiber 4g]" -> the description without the tag, plus the grams. */
export function parseFiberTag(description: string): { description: string; fiber_g: number | null } {
  const m = description.match(FIBER_TAG);
  if (!m) return { description, fiber_g: null };
  return { description: description.replace(FIBER_TAG, "").trim(), fiber_g: Number(m[1]) };
}

const SODIUM_TAG = /\s*[\[(]\s*(?:sodium|na)\s*:?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(mg|g)?\s*(?:sodium)?\s*[\])]/i;

/** "bowl of ramen [sodium 1800mg]" -> the description without the tag, plus the milligrams. */
export function parseSodiumTag(description: string): { description: string; sodium_mg: number | null } {
  const m = description.match(SODIUM_TAG);
  if (!m) return { description, sodium_mg: null };
  const n = Number(m[1].replace(/,/g, ""));
  return { description: description.replace(SODIUM_TAG, "").trim(), sodium_mg: m[2]?.toLowerCase() === "g" ? n * 1000 : n };
}

const IRON_TAG = /\s*[\[(]\s*iron\s*:?\s*(\d+(?:\.\d+)?)\s*(?:mg)?\s*[\])]/i;

/** "1 cup lentils [iron 6.6mg]" -> the description without the tag, plus the milligrams. */
export function parseIronTag(description: string): { description: string; iron_mg: number | null } {
  const m = description.match(IRON_TAG);
  if (!m) return { description, iron_mg: null };
  return { description: description.replace(IRON_TAG, "").trim(), iron_mg: Number(m[1]) };
}

function items(raw: unknown): FoodItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolError("items must be a non-empty list.");
  return raw.map((it) => {
    const nums = ["calories", "protein_g", "fat_g", "carbs_g"].map((k) => Number(it?.[k]));
    if (typeof it?.description !== "string" || nums.some((n) => !Number.isFinite(n) || n < 0 || n > 10000)) {
      throw new ToolError("Each item needs a description and non-negative calories, protein_g, fat_g, carbs_g.");
    }
    const [calories, protein_g, fat_g, carbs_g] = nums;
    // Sugar is optional so an agent that hasn't picked up the new fields can still log.
    const opt = (k: string) => {
      const n = Number(it?.[k]);
      return it?.[k] == null || !Number.isFinite(n) || n < 0 ? null : n;
    };
    // Agents with a tool list from before the sugar and fiber fields send them as tags in the description instead.
    const fe = parseIronTag(it.description);
    const na = parseSodiumTag(fe.description);
    const fiber = parseFiberTag(na.description);
    const tag = parseSugarTag(fiber.description);
    return {
      description: tag.description.slice(0, 200),
      calories, protein_g, fat_g, carbs_g,
      sugar_g: opt("sugar_g") ?? tag.sugar_g,
      added_sugar_g: opt("added_sugar_g") ?? tag.added_sugar_g,
      fiber_g: opt("fiber_g") ?? fiber.fiber_g,
      sodium_mg: opt("sodium_mg") ?? na.sodium_mg,
      iron_mg: opt("iron_mg") ?? fe.iron_mg,
    };
  });
}

async function callTool(env: Env, player: Player, name: string, args: Args, now: Date, origin: string): Promise<string> {
  const today = gameDay(now, env.GAME_TZ);
  switch (name) {
    case "get_status":
      return statusReport(env, player, now, formatOffset(utcOffsetMinutes(now, env.GAME_TZ)), `${origin}/me/${await db.privateToken(env.DB, player.id)}`);

    case "log_food": {
      const food = items(args.items);
      let mealId: number;
      let day: string;
      if (args.meal_id != null) {
        const meal = await db.getMeal(env.DB, player.id, Number(args.meal_id));
        if (!meal) throw new ToolError(`No meal ${args.meal_id} for ${player.name}. Call get_status for ids.`);
        mealId = meal.id;
        day = meal.day;
      } else {
        // A time they ate it picks the day too (a 1am snack belongs to the night before), unless a day was given.
        let eaten = args.eaten_at == null || args.eaten_at === "" ? null : time(env, args.eaten_at, now);
        if (eaten && eaten > now) eaten = now;
        day = args.day ?? (eaten ? gameDay(eaten, env.GAME_TZ) : today);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < addDays(today, -7)) {
          throw new ToolError("day must be YYYY-MM-DD, today or within the past week.");
        }
        // Agents often send the UTC date, which runs ahead of the game day at night. Never refuse a meal for that.
        if (day > today) day = today;
        // A time that doesn't fall on the meal's day is a mix-up; keep the meal and drop the time.
        if (eaten && gameDay(eaten, env.GAME_TZ) !== day) eaten = null;
        mealId = await db.createMeal(env.DB, player.id, day, args.meal_name ?? null, eaten?.toISOString() ?? null);
      }
      const added = await db.addFood(env.DB, player.id, mealId, day, food);
      const t = mealTotals({ items: added } as any);
      return [
        `Logged to meal ${mealId} (${day}):`,
        ...added.map((e) => `  item ${e.id}: ${e.description}: ${e.calories} cal, ${e.protein_g}g P, ${e.fat_g}g F, ${e.carbs_g}g C`),
        `  Added: ${t.calories} cal, ${t.protein}g protein, ${t.fat}g fat, ${t.carbs}g carbs`,
        await totalsLine(env, player, day),
        missingSugar(player, added),
        missingSodium(player, added),
        unitemizedNote(player, added),
      ].filter(Boolean).join("\n");
    }

    case "set_meal_time": {
      const meal = await db.getMeal(env.DB, player.id, Number(args.meal_id));
      if (!meal) throw new ToolError(`No meal ${args.meal_id} for ${player.name}. Call get_status for ids.`);
      let eaten = time(env, args.eaten_at, now);
      if (eaten > now) eaten = now;
      if (gameDay(eaten, env.GAME_TZ) !== meal.day) {
        throw new ToolError(`Meal ${meal.id} is on ${meal.day} (days roll over at 4am); that time falls on ${gameDay(eaten, env.GAME_TZ)}. Send a time on the meal's day, or delete it and log it again on the right day.`);
      }
      await db.setMealTime(env.DB, player.id, meal.id, eaten.toISOString());
      return `Meal ${meal.id} was eaten at ${prettyTime(eaten.toISOString(), env.GAME_TZ)} on ${prettyDay(meal.day)}.`;
    }

    case "edit_food": {
      const [item] = items([args]);
      const updated = await db.updateFood(env.DB, player.id, Number(args.item_id), item);
      if (!updated) throw new ToolError(`No item ${args.item_id} for ${player.name}. Call get_status for ids.`);
      return [
        `Updated item ${updated.id}: ${updated.description}: ${updated.calories} cal, ${updated.protein_g}g P, ${updated.fat_g}g F, ${updated.carbs_g}g C`,
        await totalsLine(env, player, updated.day),
        missingSugar(player, [updated]),
        missingSodium(player, [updated]),
        unitemizedNote(player, [updated]),
      ].filter(Boolean).join("\n");
    }

    case "delete_food": {
      const ids = Array.isArray(args.item_ids) ? args.item_ids.map(Number) : [];
      const removed = await db.deleteFood(env.DB, player.id, ids);
      if (removed.length === 0) throw new ToolError("None of those items exist. Call get_status for ids.");
      const days = [...new Set(removed.map((e) => e.day))];
      const totals = await Promise.all(days.map((d) => totalsLine(env, player, d)));
      return `Deleted: ${removed.map((e) => e.description).join("; ")}\n${totals.join("\n")}`;
    }

    case "sleep_start":
      return goToBed(env, player, time(env, args.at, now));

    case "sleep_end":
      return wakeUp(env, player, time(env, args.at, now));

    case "log_sleep": {
      const result = await logNight(env, player, time(env, args.bed_at, now), time(env, args.wake_at, now));
      if (player.pending_bed_at) await db.setPendingBed(env.DB, player.id, null);
      return result;
    }

    case "set_goal": {
      const goal = {
        goal_type: args.goal_type,
        calorie_target: Math.round(Number(args.calorie_target)),
        protein_target: Math.round(Number(args.protein_target)),
        fat_target: args.fat_target == null ? player.fat_target : Math.round(Number(args.fat_target)),
        carb_target: args.carb_target == null ? player.carb_target : Math.round(Number(args.carb_target)),
      };
      if (!["cut", "bulk"].includes(goal.goal_type) || !(goal.calorie_target > 0) || !(goal.protein_target > 0)) {
        throw new ToolError("goal_type must be cut or bulk, with positive calorie and protein targets.");
      }
      await db.setGoal(env.DB, player.id, goal);
      if (args.fiber_target != null && Number(args.fiber_target) > 0) await db.setFiberTarget(env.DB, player.id, Math.round(Number(args.fiber_target)));
      if (args.iron_target != null && Number(args.iron_target) > 0) await db.setIronTarget(env.DB, player.id, Math.round(Number(args.iron_target)));
      if (args.water_target != null && Number(args.water_target) > 0) await db.setWaterTarget(env.DB, player.id, Math.round(Number(args.water_target)));
      return `Goal set: ${goalLine((await db.getPlayer(env.DB, player.id))!)}.`;
    }

    case "log_weight": {
      const lb = Number(args.lb);
      if (!(lb > 50 && lb < 700)) throw new ToolError("lb should be a weight in pounds.");
      await db.saveWeight(env.DB, player.id, today, lb);
      if (args.goal_weight_lb != null) await db.setGoalWeight(env.DB, player.id, Number(args.goal_weight_lb));
      const goal = args.goal_weight_lb ?? player.goal_weight_lb;
      let note = "";
      if (goal != null && player.goal_type === "cut" && lb <= goal) {
        note = ` That's at or under the ${goal} lb goal. Time to switch to a maintenance target (ask them, then set_goal).`;
      }
      return `Logged ${lb} lb for ${today}.${goal != null ? ` Goal: ${goal} lb.` : ""}${note}`;
    }

    case "log_water":
    case "remove_water": {
      const day = pastDay(args.day, today, 7);
      let verb: string;
      if (name === "remove_water") {
        const oz = await db.undoWater(env.DB, player.id, day);
        if (oz == null) return `No water logged on ${prettyDay(day)}.`;
        verb = `Removed ${oz} oz from ${prettyDay(day)}.`;
      } else {
        const oz = Number(args.oz);
        if (!(oz >= 1 && oz <= 128)) throw new ToolError("oz must be 1 to 128 fluid ounces.");
        await db.addWater(env.DB, player.id, day, oz);
        verb = `Logged ${Math.round(oz * 10) / 10} oz of water for ${prettyDay(day)}.`;
      }
      const p = (await db.getPlayer(env.DB, player.id))!;
      return `${verb} ${ironWaterLine(p, await dayStats(env, p.id, day)).split(" · ")[1]}`;
    }

    case "log_workout":
    case "remove_workout": {
      const day = pastDay(args.day, today, 14);
      if (name === "remove_workout") {
        const removed = await db.deleteWorkout(env.DB, player.id, day);
        if (!removed) return `No workout logged on ${prettyDay(day)}.`;
      } else {
        const kind = String(args.kind) as WorkoutKind;
        if (!WORKOUT_KINDS.includes(kind)) throw new ToolError("kind must be gym, sport, or run.");
        const note = args.note == null ? null : String(args.note).trim().slice(0, 60) || null;
        await db.saveWorkout(env.DB, player.id, { day, kind, note });
      }
      const verb = name === "remove_workout" ? "Removed the latest workout on" : "Workout logged for";
      return `${verb} ${prettyDay(day)}. ${gymLine(player, await gymSummary(env, player, today))}.`;
    }

    case "set_sodium_goal": {
      const raw = args.max_mg;
      const n = raw == null ? null : Math.round(Number(raw));
      if (n != null && !(n >= 500 && n <= 10000)) throw new ToolError("max_mg must be 500 to 10,000 mg, or null to stop tracking.");
      await db.setSodiumTarget(env.DB, player.id, n);
      if (n == null) return "Sodium tracking is off. Sodium estimates are still saved in case they turn it back on.";
      const p = (await db.getPlayer(env.DB, player.id))!;
      return `Sodium tracking on: at most ${n.toLocaleString()}mg a day (not one of the goals). It shows in Macros on their page.\n${sodiumLine(p, await dayStats(env, p.id, today))}`;
    }

    case "set_sugar_goal": {
      const raw = args.added_max_g;
      const n = raw == null ? null : Math.round(Number(raw));
      if (n != null && !(n >= 1 && n <= 200)) throw new ToolError("added_max_g must be 1 to 200 grams, or null to stop tracking.");
      await db.setSugarTarget(env.DB, player.id, n);
      if (n == null) return "Sugar tracking is off. Sugar estimates are still saved in case they turn it back on.";
      const p = (await db.getPlayer(env.DB, player.id))!;
      return `Sugar tracking on: added sugar at most ${n}g a day (not scored). It shows on their page.\n${sugarLine(p, await dayStats(env, p.id, today))}`;
    }

    case "set_workout_target": {
      const n = Math.round(Number(args.per_week));
      if (!(n >= 1 && n <= 7)) throw new ToolError("per_week must be 1 to 7.");
      await db.setWorkoutTarget(env.DB, player.id, n);
      const p = (await db.getPlayer(env.DB, player.id))!;
      return `Workout target set to ${n} a week. ${gymLine(p, await gymSummary(env, p, today))}.`;
    }

    default:
      throw new ToolError(`Unknown tool ${name}.`);
  }
}

const TAG_HOW = `put it in the item's description as a tag, e.g. "1 cup vanilla Greek yogurt [sugar 16g, 9g added]": total sugar, then the added part (sweets, sweetened drinks, flavored yogurt, granola, sauces, honey, syrup). Sugar in whole fruit, plain milk and plain yogurt is natural, so "[sugar 14g, 0g added]" for a banana. The app reads the tag and removes it from the name`;

/** A bare total is saved but doesn't count toward the goals; ask for the actual foods. */
function unitemizedNote(player: Player, saved: { id: number; unitemized: number }[]): string {
  const ids = saved.filter((e) => e.unitemized).map((e) => e.id);
  if (!ids.length) return "";
  return `Not counted: item ${ids.join(", ")} is a total without the actual foods. Rule: a calorie number with no foods doesn't count toward the calorie or protein goal. Tell ${player.name}, ask what they actually ate, log those foods with log_food, then delete_food item ${ids.join(", ")}.`;
}

/** If a sugar tracker's items came in without sugar, ask the agent to re-save them with the tag. */
function missingSugar(player: Player, saved: { id: number; sugar_g: number | null }[]): string {
  if (player.sugar_target == null) return "";
  const ids = saved.filter((e) => e.sugar_g == null).map((e) => e.id);
  if (!ids.length) return "";
  return `Missing sugar on item${ids.length > 1 ? "s" : ""} ${ids.join(", ")}: ${player.name} tracks sugar. Re-save ${ids.length > 1 ? "each" : "it"} with edit_food (same numbers) and ${TAG_HOW}. Do this from now on for every item you log for them.`;
}

const SODIUM_TAG_HOW = `put it in the item's description as a tag, e.g. "1 bowl tonkotsu ramen [sodium 1800mg]". The app reads the tag and removes it from the name`;

/** If a sodium tracker's items came in without sodium, ask the agent to re-save them with the tag. */
function missingSodium(player: Player, saved: { id: number; sodium_mg: number | null }[]): string {
  if (player.sodium_target == null) return "";
  const ids = saved.filter((e) => e.sodium_mg == null).map((e) => e.id);
  if (!ids.length) return "";
  return `Missing sodium on item${ids.length > 1 ? "s" : ""} ${ids.join(", ")}: ${player.name} tracks sodium. Re-save ${ids.length > 1 ? "each" : "it"} with edit_food (same numbers) and ${SODIUM_TAG_HOW}. Do this from now on for every item you log for them.`;
}

/**
 * Notes for the agent about features its saved tool list may not include, so nobody has to reconnect
 * the integration. Shown on get_status, and on the first other tool call each day.
 */
async function agentNotes(env: Env, player: Player, tool: string, origin: string, today: string): Promise<string> {
  const once = tool !== "get_status" && !(await db.firstTime(env.DB, `notes:${player.id}:${today}`));
  if (once) return "";
  const page = `${origin}/me/${await db.privateToken(env.DB, player.id)}`;
  const notes = [
    `Workouts and water are logged only through you (there are no buttons on the page). If you don't have log_workout or log_water tools, or log_food has no eaten_at field, tell ${player.name} once to remove and re-add the Health Tracker integration in Poke so the new tools show up.`,
    `Meal times: the app compares how close to bed ${player.name} last ate with how long they slept. If they ate something a while before telling you, pass eaten_at to log_food; fix a wrong time with set_meal_time.`,
    `Iron: if your log_food items have no iron_mg field, add it to the item's description as a tag, e.g. "1 cup lentils [iron 6.6mg]". The app reads the tag and removes it from the name.`,
  ];
  notes.push(`Fiber: if your log_food items have no fiber_g field, add it to the item's description as a tag, e.g. "1 cup oatmeal [fiber 4g]". The app reads the tag and removes it from the name.`);
  if (player.sugar_target != null) {
    notes.push(`Sugar: ${player.name} tracks added vs natural sugar (limit ${player.sugar_target}g added). If your log_food items have no sugar_g field, ${TAG_HOW}.`);
  }
  if (player.sodium_target != null) {
    notes.push(`Sodium: ${player.name} tracks sodium (limit ${player.sodium_target.toLocaleString()}mg). If your log_food items have no sodium_mg field, ${SODIUM_TAG_HOW}. Count salt and salty seasonings added while cooking or at the table (salt, seasoned salt and blends, Tajín, bouillon, soy sauce, hot sauce, seasoning packets) as their own item: 1/4 tsp of salt is about 575mg. Plain spices and salt-free blends (garlic or onion powder, pepper, paprika, cumin, chili flakes) have essentially none. Ask what they seasoned home-cooked food with if they didn't say. If you don't have a set_sodium_goal tool, they change the limit on their page: ${page}#settings`);
  }
  return `\n\nNotes for you (the agent), not for them:\n${notes.map((n) => `- ${n}`).join("\n")}`;
}

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: any;
}

async function handleRpc(env: Env, player: Player, req: RpcRequest, origin: string): Promise<object | null> {
  const reply = (result: object) => ({ jsonrpc: "2.0", id: req.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: "2.0", id: req.id ?? null, error: { code, message } });

  if (req.id === undefined) return null; // notification, e.g. notifications/initialized
  switch (req.method) {
    case "initialize": {
      const asked = req.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "health-tracker", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: tools() });
    case "tools/call": {
      const { name, arguments: args } = req.params ?? {};
      try {
        // Re-read the player so goals and pending bedtime are current.
        const fresh = (await db.getPlayer(env.DB, player.id))!;
        const now = new Date();
        const text = (await callTool(env, fresh, name, args ?? {}, now, origin)) + (await agentNotes(env, fresh, name, origin, gameDay(now, env.GAME_TZ)));
        return reply({ content: [{ type: "text", text }] });
      } catch (err) {
        if (err instanceof UserError) {
          return reply({ content: [{ type: "text", text: `Error: ${err.message}` }], isError: true });
        }
        console.error("tool failed", name, err);
        return reply({ content: [{ type: "text", text: "Error: something broke on the server. Nothing was saved; try again." }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${req.method}`);
  }
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("This MCP server only supports POST (Streamable HTTP, JSON responses).", {
      status: 405,
      headers: { allow: "POST" },
    });
  }
  const key = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const found = key ? await db.playerByKey(env.DB, key) : null;
  const player = found && found.name.toLowerCase() === env.OWNER_NAME.toLowerCase() ? found : null;
  if (!player) {
    return Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or unknown API key. Get one from the setup page." } },
      { status: 401, headers: { "www-authenticate": "Bearer" } },
    );
  }

  let body: RpcRequest | RpcRequest[];
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(body);
  const list: RpcRequest[] = Array.isArray(body) ? body : [body];
  const responses = (await Promise.all(list.map((r) => handleRpc(env, player, r, new URL(request.url).origin)))).filter(Boolean);
  if (responses.length === 0) return new Response(null, { status: 202 });
  return Response.json(batch ? responses : responses[0]);
}
