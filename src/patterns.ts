// Patterns: looks back over recent days and food, and says what's been running low or high and
// what to eat about it. Pure functions, so the page and Poke can both use them and tests can too.
import type { Player } from "./db";
import type { DayStats } from "./scoring";

export interface LoggedFood {
  day: string;
  description: string;
  sodium_mg: number | null;
  iron_mg: number | null;
  fiber_g: number | null;
  added_sugar_g: number | null;
}

/** Foods people log under many names, matched first so "1 scoop whey in water" and "protein shake" group. */
const KNOWN: [RegExp, string][] = [
  [/cottage cheese/, "cottage cheese"],
  [/greek yogh?urt|\bskyr\b|\biogurt\b/, "Greek yogurt"],
  [/\bwhey\b|protein (shake|powder)|premier protein|fairlife.*shake|\bshake\b/, "protein shakes"],
  [/protein bar|quest bar|\brxbar\b|barebells/, "protein bars"],
  [/\btuna\b/, "tuna"],
  [/\bsalmon\b/, "salmon"],
  [/chicken/, "chicken"],
  [/turkey/, "turkey"],
  [/beef|steak|burger/, "beef"],
  [/egg whites?/, "egg whites"],
  [/\beggs?\b/, "eggs"],
  [/\btofu\b/, "tofu"],
  [/\brice\b/, "rice"],
  [/oatmeal|\boats\b/, "oats"],
  [/granola/, "granola"],
  [/bread|toast|bagel/, "bread"],
  [/pasta|noodle|ramen/, "pasta and noodles"],
  [/potato|fries/, "potatoes"],
  [/banana/, "bananas"],
  [/berr(y|ies)/, "berries"],
  [/apple/, "apples"],
  [/avocado|guac/, "avocado"],
  [/peanut butter|\bpb\b|almond butter/, "nut butter"],
  [/cheese/, "cheese"],
  [/\bmilk\b/, "milk"],
  [/coffee|latte|espresso|americano/, "coffee drinks"],
  [/salad/, "salad"],
  [/spinach/, "spinach"],
  [/broccoli/, "broccoli"],
  [/lentil/, "lentils"],
  [/\bbeans?\b|chickpea|hummus/, "beans"],
  [/seasoning|seasoned salt|\bsalt\b|tajin|bouillon/, "salty seasoning"],
  [/soy sauce|teriyaki/, "soy sauce"],
  [/deli|lunch meat|\bham\b|salami|jerky/, "deli meat and jerky"],
  [/chips|pretzel|popcorn/, "chips and pretzels"],
  [/candy|chocolate|cookie|ice cream|dessert/, "sweets"],
];

const FILLER = /\b(\d+([./]\d+)?|[½¼¾⅓⅔⅛]|cups?|oz|ounces?|g|grams?|tbsp|tsp|scoops?|slices?|servings?|cans?|bowls?|pieces?|handful|large|medium|small|of|a|an|the|some|nonfat|non-fat|fat-free|low-fat|lowfat|plain|light)\b/g;

/** A short, groupable name for a logged item: "1/2 cup lowfat cottage cheese (Good Culture)" -> "cottage cheese". */
export function foodName(description: string): string {
  const d = description.toLowerCase().replace(/[\[(][^\])]*[\])]/g, " ").replace(/w\//g, "with ");
  for (const [re, name] of KNOWN) if (re.test(d)) return name;
  const main = d.split(/\s+with\s+|,|\+|\s+and\s+/)[0];
  return main.replace(/[%]/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 3).join(" ") || d.trim();
}

/** Ideas for each gap. Anything already among their regulars is skipped so the ideas are new. */
const IDEAS: Record<"iron" | "fiber" | "fat", string[]> = {
  iron: ["lentils", "lean beef", "spinach", "fortified cereal", "edamame", "chickpeas", "tofu", "pumpkin seeds"],
  fiber: ["raspberries", "chia seeds", "oats", "black beans", "pears", "broccoli"],
  fat: ["avocado", "salmon", "almonds", "olive oil", "nut butter"],
};

/** Lower-sodium versions of common staples. */
const SODIUM_SWAPS: Record<string, string> = {
  "cottage cheese": "low-sodium or no-salt-added cottage cheese",
  "salty seasoning": "salt-free blends, with a pinch of salt at the end",
  "soy sauce": "low-sodium soy sauce or coconut aminos",
  "deli meat and jerky": "chicken or turkey you cook yourself",
  tuna: "no-salt-added tuna",
  "chips and pretzels": "unsalted popcorn or nuts",
  bread: "lower-sodium bread",
  cheese: "fresh mozzarella or Swiss, the lowest-sodium cheeses",
  "pasta and noodles": "skipping the seasoning packet",
};

type Gap = "iron" | "fiber" | "fat" | "sodium" | "sugar";
const GAP_WORDS: Record<Gap, string> = { iron: "more iron", fiber: "more fiber", fat: "healthy fats", sodium: "less sodium", sugar: "less added sugar" };

/**
 * Swaps for staples, each tagged with the gaps it helps. The swap that helps their biggest gaps wins,
 * so the same staple gets a different suggestion depending on what's actually missing.
 */
const SWAPS: Record<string, { to: string; adds: Gap[] }[]> = {
  chicken: [{ to: "93% lean ground beef or steak", adds: ["iron"] }, { to: "salmon", adds: ["fat"] }],
  tuna: [{ to: "canned sardines or salmon", adds: ["fat", "iron"] }, { to: "no-salt-added tuna", adds: ["sodium"] }],
  "protein shakes": [{ to: "Cream of Wheat made with water, protein powder stirred in", adds: ["iron"] }, { to: "a shake blended with chia seeds and berries", adds: ["fiber"] }],
  "cottage cheese": [{ to: "low-sodium cottage cheese", adds: ["sodium"] }, { to: "edamame", adds: ["iron", "fiber"] }],
  "Greek yogurt": [{ to: "plain Greek yogurt with chia seeds and raspberries", adds: ["fiber", "sugar"] }],
  "egg whites": [{ to: "whole eggs (some of them)", adds: ["fat", "iron"] }, { to: "tofu scramble", adds: ["iron"] }],
  eggs: [{ to: "tofu scramble", adds: ["iron"] }],
  turkey: [{ to: "lean beef", adds: ["iron"] }],
  rice: [{ to: "quinoa or lentil pasta", adds: ["iron", "fiber"] }],
  "pasta and noodles": [{ to: "lentil or chickpea pasta", adds: ["iron", "fiber"] }],
  bread: [{ to: "whole-grain bread", adds: ["fiber"] }],
  oats: [{ to: "Cream of Wheat (more iron) on some days", adds: ["iron"] }],
  granola: [{ to: "Grape-Nuts", adds: ["iron", "sugar"] }],
  "protein bars": [{ to: "edamame or roasted chickpeas", adds: ["iron", "fiber", "sugar"] }],
  "chips and pretzels": [{ to: "pumpkin seeds", adds: ["iron", "fat", "sodium"] }],
  "deli meat and jerky": [{ to: "chicken or beef you cook yourself", adds: ["sodium"] }],
  "salty seasoning": [{ to: "salt-free seasoning blends", adds: ["sodium"] }],
  "soy sauce": [{ to: "low-sodium soy sauce", adds: ["sodium"] }],
  cheese: [{ to: "avocado", adds: ["fat", "fiber", "sodium"] }],
  sweets: [{ to: "dark chocolate (70%+)", adds: ["iron", "sugar"] }],
  bananas: [{ to: "raspberries or pears", adds: ["fiber"] }],
};

export interface Swap {
  from: string;
  to: string;
  why: string; // e.g. "more iron and more fiber"
}

const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const r1 = (n: number) => Math.round(n * 10) / 10;

export interface Regular {
  name: string;
  count: number; // times logged
  days: number; // distinct days
  sodium: number | null; // average mg per time logged, null if never estimated
  iron: number | null;
}

/** Their most-logged foods over the window, most frequent first. */
export function regulars(foods: LoggedFood[]): Regular[] {
  const by = new Map<string, LoggedFood[]>();
  for (const f of foods) {
    const k = foodName(f.description);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(f);
  }
  const mean = (xs: (number | null)[]) => {
    const k = xs.filter((x): x is number => x != null);
    return k.length ? avg(k) : null;
  };
  return [...by.entries()]
    .map(([name, fs]) => ({ name, count: fs.length, days: new Set(fs.map((f) => f.day)).size, sodium: mean(fs.map((f) => f.sodium_mg)), iron: mean(fs.map((f) => f.iron_mg)) }))
    .sort((a, b) => b.count - a.count || b.days - a.days);
}

export interface Patterns {
  notes: string[]; // up to three sentences, most important first
  swaps: Swap[]; // concrete grocery swaps for their staples, aimed at the biggest gaps
}

/**
 * What's worth changing, from `days` (finished days, not today) and `foods` (a longer window of items).
 */
export function patterns(p: Player, days: DayStats[], foods: LoggedFood[]): Patterns {
  const fed = days.filter((s) => s.foodCount > 0);
  if (fed.length < 3) return { notes: [], swaps: [] };
  const gaps = new Map<Gap, number>();
  const regs = regulars(foods);
  const top = regs.filter((r) => r.days >= 3).slice(0, 5);
  const topNames = top.map((r) => r.name);
  const fresh = (ideas: string[]) => ideas.filter((i) => !regs.slice(0, 12).some((r) => r.name.toLowerCase().includes(i) || i.includes(r.name.toLowerCase()))).slice(0, 3);
  const known = (k: "iron" | "fiber" | "sodium" | "addedSugar") => fed.map((s) => s[k]).filter((v): v is number => v != null);
  const span = `${fed.length} days`;
  const out: { weight: number; text: string }[] = [];

  // Iron: their regulars that have almost none, and new foods that have a lot.
  const iron = known("iron");
  const ironTarget = p.iron_target;
  if (ironTarget != null && iron.length >= 3 && avg(iron) < ironTarget * 0.85) {
    gaps.set("iron", 1 - avg(iron) / ironTarget + 0.2);
    const empty = top.filter((r) => r.iron != null && r.iron < 0.5).map((r) => r.name).slice(0, 3);
    const because = empty.length ? ` Your go-tos (${list(empty)}) have almost none.` : "";
    out.push({
      weight: 1 - avg(iron) / ironTarget + 0.2,
      text: `Iron has averaged ${r1(avg(iron))} mg a day over the last ${span}, against ${ironTarget}.${because} Next grocery run, add ${list(fresh(IDEAS.iron))}, and eat them with berries or peppers, away from dairy and coffee.`,
    });
  }

  // Sodium: name the biggest sources and a swap for each.
  const sodium = known("sodium");
  const sodiumMax = p.sodium_target;
  if (sodiumMax != null && sodium.length >= 3 && avg(sodium) > sodiumMax) {
    gaps.set("sodium", avg(sodium) / sodiumMax - 1 + 0.15);
    const sources = regs
      .filter((r) => r.sodium != null && r.sodium >= 250)
      .map((r) => ({ ...r, total: r.sodium! * r.count }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 2);
    const swaps = sources.map((s) => (SODIUM_SWAPS[s.name] ? `${SODIUM_SWAPS[s.name]} instead of regular ${s.name}` : null)).filter(Boolean) as string[];
    const from = sources.length ? ` Most of it is from ${list(sources.map((s) => s.name))}.` : "";
    const fix = swaps.length ? ` Try ${list(swaps)}.` : " Cooking more at home and seasoning with salt-free blends is the fastest fix.";
    out.push({ weight: avg(sodium) / sodiumMax - 1 + 0.15, text: `Sodium has averaged ${Math.round(avg(sodium)).toLocaleString("en-US")} mg a day, over your ${sodiumMax.toLocaleString("en-US")} limit.${from}${fix}` });
  }

  // Fiber.
  const fiber = known("fiber");
  if (p.fiber_target != null && fiber.length >= 3 && avg(fiber) < p.fiber_target * 0.75) {
    gaps.set("fiber", 1 - avg(fiber) / p.fiber_target);
    out.push({
      weight: 1 - avg(fiber) / p.fiber_target,
      text: `Fiber has averaged ${Math.round(avg(fiber))} g a day, against ${p.fiber_target}. ${list(fresh(IDEAS.fiber)).replace(/^./, (c) => c.toUpperCase())} are easy adds that go with what you already eat.`,
    });
  }

  // Fat: too little is common on a cut and matters for hormones.
  const fat = fed.map((s) => s.fat);
  if (p.fat_target != null && avg(fat) < p.fat_target * 0.75) {
    gaps.set("fat", 1 - avg(fat) / p.fat_target);
    out.push({
      weight: 1 - avg(fat) / p.fat_target,
      text: `Fat has averaged ${Math.round(avg(fat))} g a day, against at least ${p.fat_target}. Too little for long stretches can throw off your period and hormones. Add ${list(fresh(IDEAS.fat))}.`,
    });
  }

  // Water.
  const water = days.map((s) => s.water ?? 0);
  if (p.water_target != null && water.some((w) => w > 0) && avg(water) < p.water_target * 0.75) {
    out.push({ weight: 1 - avg(water) / p.water_target, text: `Water has averaged ${Math.round(avg(water))} oz a day, against ${p.water_target}. A bottle with each meal gets you most of the way.` });
  }

  // Added sugar.
  const sugar = known("addedSugar");
  if (p.sugar_target != null && sugar.length >= 3 && avg(sugar) > p.sugar_target) {
    gaps.set("sugar", avg(sugar) / p.sugar_target - 1);
    out.push({ weight: avg(sugar) / p.sugar_target - 1, text: `Added sugar has averaged ${Math.round(avg(sugar))} g a day, over your ${p.sugar_target} g limit. Check flavored yogurt, granola, protein bars and coffee drinks, which hide a lot of it.` });
  }

  // Variety: the same few foods making up most of what they eat.
  const total = foods.length;
  const share = top.reduce((n, r) => n + r.count, 0) / Math.max(1, total);
  if (top.length >= 3 && total >= 15 && share >= 0.5) {
    out.push({
      weight: share - 0.4,
      text: `${Math.round(share * 100)}% of what you've logged lately is the same ${top.length} foods (${list(topNames)}). That's fine for hitting protein, but it's how a nutrient goes missing for weeks. The swaps below are aimed at what's running low.`,
    });
  }

  return { notes: out.sort((a, b) => b.weight - a.weight).slice(0, 3).map((o) => o.text), swaps: groceSwaps(regs, gaps) };
}

/** For each staple they buy, the swap that helps their biggest gaps the most. Up to three, best first. */
export function groceSwaps(regs: Regular[], gaps: Map<Gap, number>): Swap[] {
  if (!gaps.size) return [];
  const used = new Set<string>();
  return regs
    .filter((r) => r.days >= 2 && SWAPS[r.name])
    .slice(0, 10)
    .map((r) => {
      const best = SWAPS[r.name]
        .map((o) => ({ o, score: o.adds.reduce((n, g) => n + (gaps.get(g) ?? 0), 0) }))
        .sort((a, b) => b.score - a.score)[0];
      // How often they eat it matters too: swapping a daily staple does more than a weekly one.
      return { r, o: best.o, score: best.score * (1 + Math.min(r.days, 7) / 7) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((x) => !used.has(x.o.to) && used.add(x.o.to))
    .slice(0, 3)
    .map(({ r, o }) => ({ from: r.name, to: o.to, why: list(o.adds.filter((g) => gaps.has(g)).map((g) => GAP_WORDS[g])) }));
}
