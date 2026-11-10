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

/**
 * Up to three things worth changing, most important first, as plain sentences.
 * `days` are finished days (not today), newest last; `foods` is what was logged over a longer window.
 */
export function patterns(p: Player, days: DayStats[], foods: LoggedFood[]): string[] {
  const fed = days.filter((s) => s.foodCount > 0);
  if (fed.length < 3) return [];
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
    out.push({
      weight: 1 - avg(fiber) / p.fiber_target,
      text: `Fiber has averaged ${Math.round(avg(fiber))} g a day, against ${p.fiber_target}. ${list(fresh(IDEAS.fiber)).replace(/^./, (c) => c.toUpperCase())} are easy adds that go with what you already eat.`,
    });
  }

  // Fat: too little is common on a cut and matters for hormones.
  const fat = fed.map((s) => s.fat);
  if (p.fat_target != null && avg(fat) < p.fat_target * 0.75) {
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
    out.push({ weight: avg(sugar) / p.sugar_target - 1, text: `Added sugar has averaged ${Math.round(avg(sugar))} g a day, over your ${p.sugar_target} g limit. Check flavored yogurt, granola, protein bars and coffee drinks, which hide a lot of it.` });
  }

  // Variety: the same few foods making up most of what they eat.
  const total = foods.length;
  const share = top.reduce((n, r) => n + r.count, 0) / Math.max(1, total);
  if (top.length >= 3 && total >= 15 && share >= 0.5) {
    out.push({
      weight: share - 0.4,
      text: `${Math.round(share * 100)}% of what you've logged lately is the same ${top.length} foods (${list(topNames)}). That's fine for hitting protein, but it's how a nutrient goes missing for weeks. Swap one new thing into each grocery run.`,
    });
  }

  return out.sort((a, b) => b.weight - a.weight).slice(0, 3).map((o) => o.text);
}
