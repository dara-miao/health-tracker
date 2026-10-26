import type { Workout } from "./gym";
import { EMPTY_DAY, looksUnitemized, type DayStats, type GoalType, type Rules } from "./scoring";
import { addDays } from "./time";

export interface Env {
  DB: D1Database;
  GAME_TZ: string;
  SLEEP_TARGET_HOURS: string;
  CUT_FLOOR_CALORIES: string;
  WAKE_WEEKDAY: string; // "08:30"
  WAKE_WEEKEND: string; // "10:30"
  WAKE_GRACE_MINUTES: string;
  CALORIE_GRACE?: string;
  PROTEIN_GRACE_G?: string;
  BREAK_DAYS?: string; // "2026-10-08,2026-10-09" or ranges "2026-11-25..2026-11-29"
  JOIN_CODE: string;
  OWNER_NAME: string; // the one player this app is for
  POKE_API_URL?: string; // override for local testing
}

const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Parses "2026-10-08,2026-11-25..2026-11-29" into the set of dates. */
export function breakDays(raw: string | undefined): Set<string> {
  const out = new Set<string>();
  for (const part of (raw ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    const [from, to = from] = part.split("..").map((x) => x.trim());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
    for (let d = from, n = 0; d <= to && n < 60; d = addDays(d, 1), n++) out.add(d);
  }
  return out;
}

export function rules(env: Env): Rules {
  return {
    tz: env.GAME_TZ,
    sleepTargetMinutes: Math.round(Number(env.SLEEP_TARGET_HOURS) * 60),
    cutFloorCalories: Number(env.CUT_FLOOR_CALORIES),
    wakeWeekday: clock(env.WAKE_WEEKDAY),
    wakeWeekend: clock(env.WAKE_WEEKEND),
    wakeGraceMinutes: Number(env.WAKE_GRACE_MINUTES),
    breakDays: breakDays(env.BREAK_DAYS),
    calorieGrace: Number(env.CALORIE_GRACE ?? 50),
    proteinGrace: Number(env.PROTEIN_GRACE_G ?? 5),
  };
}

export interface Player {
  id: number;
  name: string;
  poke_api_key: string | null;
  goal_type: GoalType | null;
  calorie_target: number | null;
  protein_target: number | null;
  fat_target: number | null;
  carb_target: number | null;
  workout_target: number | null;
  sugar_target: number | null;
  fiber_target: number | null;
  goal_weight_lb: number | null;
  pending_bed_at: string | null;
}

const PLAYER_COLS =
  "id, name, poke_api_key, goal_type, calorie_target, protein_target, fat_target, carb_target, workout_target, sugar_target, fiber_target, goal_weight_lb, pending_bed_at";

export interface FoodEntry {
  id: number;
  meal_id: number;
  day: string;
  description: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sugar_g: number | null;
  added_sugar_g: number | null;
  fiber_g: number | null;
  unitemized: number;
}

const FOOD_COLS = "id, meal_id, day, description, calories, protein_g, fat_g, carbs_g, sugar_g, added_sugar_g, fiber_g, unitemized";

export interface FoodItem {
  description: string;
  calories: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  sugar_g: number | null;
  added_sugar_g: number | null;
  fiber_g: number | null;
}

export interface Meal {
  id: number;
  player_id: number;
  day: string;
  name: string | null;
  created_at: string;
}

export interface MealWithItems extends Meal {
  items: FoodEntry[];
}

export interface SleepEntry {
  day: string;
  bed_at: string;
  wake_at: string;
  minutes: number;
}

// ---------- players ----------

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Creates the owner, or re-links an existing one (same name) to a new API key and private link. */
export async function joinPlayer(db: D1Database, name: string, apiKeyHash: string, privateToken: string, pokeKey: string | null) {
  await db
    .prepare(
      `INSERT INTO players (name, api_key_hash, private_token, poke_api_key) VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO UPDATE SET api_key_hash = excluded.api_key_hash, private_token = excluded.private_token,
         poke_api_key = COALESCE(excluded.poke_api_key, players.poke_api_key)`,
    )
    .bind(name, apiKeyHash, privateToken, pokeKey)
    .run();
}

/** The app's one player (OWNER_NAME). Other rows in the players table are ignored everywhere. */
export async function owner(env: Env): Promise<Player | null> {
  return env.DB.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE name = ?`).bind(env.OWNER_NAME).first<Player>();
}

export async function playerByPrivateToken(db: D1Database, token: string): Promise<Player | null> {
  return db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE private_token = ?`).bind(token).first<Player>();
}

export async function privateToken(db: D1Database, id: number): Promise<string> {
  return (await db.prepare("SELECT private_token FROM players WHERE id = ?").bind(id).first<{ private_token: string }>())!.private_token;
}

export async function playerByKey(db: D1Database, apiKey: string): Promise<Player | null> {
  const hash = await sha256(apiKey);
  return db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE api_key_hash = ?`).bind(hash).first<Player>();
}

export async function getPlayer(db: D1Database, id: number): Promise<Player | null> {
  return db.prepare(`SELECT ${PLAYER_COLS} FROM players WHERE id = ?`).bind(id).first<Player>();
}

export async function setGoal(
  db: D1Database,
  id: number,
  goal: { goal_type: GoalType; calorie_target: number; protein_target: number; fat_target: number | null; carb_target: number | null },
) {
  await db
    .prepare("UPDATE players SET goal_type = ?, calorie_target = ?, protein_target = ?, fat_target = ?, carb_target = ? WHERE id = ?")
    .bind(goal.goal_type, goal.calorie_target, goal.protein_target, goal.fat_target, goal.carb_target, id)
    .run();
}

export async function setGoalWeight(db: D1Database, id: number, lb: number | null) {
  await db.prepare("UPDATE players SET goal_weight_lb = ? WHERE id = ?").bind(lb, id).run();
}

export async function setPendingBed(db: D1Database, id: number, iso: string | null) {
  await db.prepare("UPDATE players SET pending_bed_at = ? WHERE id = ?").bind(iso, id).run();
}

// ---------- meals & food ----------

export async function createMeal(db: D1Database, playerId: number, day: string, name: string | null) {
  const row = await db
    .prepare("INSERT INTO meals (player_id, day, name) VALUES (?, ?, ?) RETURNING id")
    .bind(playerId, day, name)
    .first<{ id: number }>();
  return row!.id;
}

export async function getMeal(db: D1Database, playerId: number, mealId: number): Promise<Meal | null> {
  return db.prepare("SELECT * FROM meals WHERE id = ? AND player_id = ?").bind(mealId, playerId).first<Meal>();
}

/** Sugar is optional; added sugar can't be more than the total. */
function sugarCols(it: FoodItem): (number | null)[] {
  if (it.sugar_g == null) return [null, null];
  const total = Math.round(it.sugar_g);
  return [total, it.added_sugar_g == null ? null : Math.min(total, Math.round(it.added_sugar_g))];
}

/** Fiber is optional, like sugar. */
function fiberCol(it: FoodItem): number | null {
  return it.fiber_g == null ? null : Math.round(it.fiber_g);
}

export async function addFood(db: D1Database, playerId: number, mealId: number, day: string, items: FoodItem[]) {
  const stmt = db.prepare(
    `INSERT INTO food_entries (meal_id, player_id, day, description, calories, protein_g, fat_g, carbs_g, sugar_g, added_sugar_g, fiber_g, unitemized)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${FOOD_COLS}`,
  );
  const results = await db.batch<FoodEntry>(
    items.map((it) =>
      stmt.bind(mealId, playerId, day, it.description, ...[it.calories, it.protein_g, it.fat_g, it.carbs_g].map(Math.round), ...sugarCols(it), fiberCol(it), looksUnitemized(it) ? 1 : 0),
    ),
  );
  return results.map((r) => r.results[0]);
}

export async function updateFood(db: D1Database, playerId: number, entryId: number, item: FoodItem) {
  return db
    .prepare(
      `UPDATE food_entries SET description = ?, calories = ?, protein_g = ?, fat_g = ?, carbs_g = ?, sugar_g = ?, added_sugar_g = ?, fiber_g = ?, unitemized = ?
       WHERE id = ? AND player_id = ? RETURNING ${FOOD_COLS}`,
    )
    .bind(item.description, ...[item.calories, item.protein_g, item.fat_g, item.carbs_g].map(Math.round), ...sugarCols(item), fiberCol(item), looksUnitemized(item) ? 1 : 0, entryId, playerId)
    .first<FoodEntry>();
}

/** Deletes only the player's own entries, and any meals left empty. Returns what was removed. */
export async function deleteFood(db: D1Database, playerId: number, ids: number[]): Promise<FoodEntry[]> {
  if (ids.length === 0) return [];
  const stmt = db.prepare(`DELETE FROM food_entries WHERE id = ? AND player_id = ? RETURNING ${FOOD_COLS}`);
  const removed = (await db.batch<FoodEntry>(ids.map((id) => stmt.bind(id, playerId)))).flatMap((r) => r.results);
  await db
    .prepare("DELETE FROM meals WHERE player_id = ? AND id NOT IN (SELECT meal_id FROM food_entries WHERE player_id = ?)")
    .bind(playerId, playerId)
    .run();
  return removed;
}

export async function mealsForDay(db: D1Database, playerId: number, day: string): Promise<MealWithItems[]> {
  const [meals, items] = await db.batch<any>([
    db.prepare("SELECT * FROM meals WHERE player_id = ? AND day = ? ORDER BY id").bind(playerId, day),
    db.prepare(`SELECT ${FOOD_COLS} FROM food_entries WHERE player_id = ? AND day = ? ORDER BY id`).bind(playerId, day),
  ]);
  return (meals.results as Meal[]).map((m) => ({
    ...m,
    items: (items.results as FoodEntry[]).filter((i) => i.meal_id === m.id),
  }));
}

/** Per-day stats for one player over an inclusive range of days. */
export async function statsForRange(
  db: D1Database,
  playerId: number,
  from: string,
  to: string,
): Promise<Map<string, DayStats>> {
  const [food, sleep] = await db.batch<any>([
    db
      .prepare(
        `SELECT day, SUM(calories) AS calories, SUM(protein_g) AS protein, SUM(fat_g) AS fat, SUM(carbs_g) AS carbs,
                SUM(sugar_g) AS sugar, SUM(added_sugar_g) AS added_sugar, SUM(fiber_g) AS fiber, SUM(unitemized) AS unitemized, COUNT(*) AS n
         FROM food_entries WHERE player_id = ? AND day BETWEEN ? AND ? GROUP BY day`,
      )
      .bind(playerId, from, to),
    db.prepare("SELECT day, minutes, wake_at, bed_at FROM sleep_entries WHERE player_id = ? AND day BETWEEN ? AND ?").bind(playerId, from, to),
  ]);
  const out = new Map<string, DayStats>();
  const get = (day: string) => {
    if (!out.has(day)) out.set(day, { ...EMPTY_DAY });
    return out.get(day)!;
  };
  for (const r of food.results) {
    Object.assign(get(r.day), { calories: r.calories, protein: r.protein, fat: r.fat, carbs: r.carbs, sugar: r.sugar, addedSugar: r.added_sugar, fiber: r.fiber, unitemized: r.unitemized, foodCount: r.n });
  }
  for (const r of sleep.results) Object.assign(get(r.day), { sleepMinutes: r.minutes, wakeAt: r.wake_at, bedAt: r.bed_at });
  return out;
}

export async function firstActivityDay(db: D1Database, playerId: number): Promise<string | null> {
  const row = await db
    .prepare("SELECT MIN(day) AS day FROM (SELECT day FROM food_entries WHERE player_id = ? UNION ALL SELECT day FROM sleep_entries WHERE player_id = ?)")
    .bind(playerId, playerId)
    .first<{ day: string | null }>();
  return row?.day ?? null;
}

// ---------- sleep & weight ----------

export async function saveSleep(db: D1Database, playerId: number, entry: SleepEntry) {
  await db
    .prepare(
      `INSERT INTO sleep_entries (player_id, day, bed_at, wake_at, minutes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (player_id, day) DO UPDATE SET bed_at = excluded.bed_at, wake_at = excluded.wake_at, minutes = excluded.minutes`,
    )
    .bind(playerId, entry.day, entry.bed_at, entry.wake_at, entry.minutes)
    .run();
}

export async function saveWeight(db: D1Database, playerId: number, day: string, lb: number) {
  await db
    .prepare("INSERT INTO weights (player_id, day, lb) VALUES (?, ?, ?) ON CONFLICT (player_id, day) DO UPDATE SET lb = excluded.lb")
    .bind(playerId, day, lb)
    .run();
}

export async function weightsForPlayer(db: D1Database, playerId: number): Promise<{ day: string; lb: number }[]> {
  const { results } = await db
    .prepare("SELECT day, lb FROM weights WHERE player_id = ? ORDER BY day")
    .bind(playerId)
    .all<{ day: string; lb: number }>();
  return results;
}

// ---------- workouts ----------

export async function saveWorkout(db: D1Database, playerId: number, w: Workout) {
  await db
    .prepare(
      "INSERT INTO workouts (player_id, day, kind, note) VALUES (?, ?, ?, ?)",
    )
    .bind(playerId, w.day, w.kind, w.note)
    .run();
}

export async function deleteWorkout(db: D1Database, playerId: number, day: string): Promise<boolean> {
  // One at a time: the most recent workout that day.
  const r = await db
    .prepare("DELETE FROM workouts WHERE id = (SELECT id FROM workouts WHERE player_id = ? AND day = ? ORDER BY id DESC LIMIT 1)")
    .bind(playerId, day)
    .run();
  return r.meta.changes > 0;
}

export async function deleteWorkoutById(db: D1Database, playerId: number, id: number) {
  await db.prepare("DELETE FROM workouts WHERE id = ? AND player_id = ?").bind(id, playerId).run();
}

export async function workoutsForPlayer(db: D1Database, playerId: number, from: string): Promise<Workout[]> {
  const { results } = await db
    .prepare("SELECT id, day, kind, note FROM workouts WHERE player_id = ? AND day >= ? ORDER BY day, id")
    .bind(playerId, from)
    .all<Workout>();
  return results;
}

export async function setFiberTarget(db: D1Database, id: number, grams: number | null) {
  await db.prepare("UPDATE players SET fiber_target = ? WHERE id = ?").bind(grams, id).run();
}

export async function setSugarTarget(db: D1Database, id: number, maxAddedGrams: number | null) {
  await db.prepare("UPDATE players SET sugar_target = ? WHERE id = ?").bind(maxAddedGrams, id).run();
}

export async function setWorkoutTarget(db: D1Database, id: number, perWeek: number) {
  await db.prepare("UPDATE players SET workout_target = ? WHERE id = ?").bind(perWeek, id).run();
}

// ---------- misc ----------

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string) {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

/** Returns true the first time a key is seen, false after that. */
export async function firstTime(db: D1Database, key: string): Promise<boolean> {
  const res = await db.prepare("INSERT OR IGNORE INTO seen (key) VALUES (?)").bind(key).run();
  return res.meta.changes > 0;
}
