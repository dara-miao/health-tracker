import * as db from "./db";
import type { Env, Player } from "./db";
import { WORKOUT_KINDS, type WorkoutKind } from "./gym";
import { dayRecap, eveningNudge, trackingStart, weekSummary } from "./game";
import { handleMcp } from "./mcp";
import { sendToPoke } from "./poke";
import { addDays, gameDay, localParts, weekStart } from "./time";
import { ICON_PNG_180, ICON_PNG_512, ICON_PNG_64, ICON_SVG, MANIFEST } from "./icons";
import { historyPage, homePage, joinPage, joinSuccess, lockedPage } from "./web";

const RECAP_HOUR = 10; // daily recap (and Monday's week summary) goes out at 10am
const NUDGE_HOUR = 21; // evening check-in at 9pm

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (path === "/mcp") return handleMcp(request, env);

    const cached = (body: BodyInit, type: string) =>
      new Response(body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
    const png = (b64: string) => cached(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), "image/png");
    if (path === "/favicon.svg") return cached(ICON_SVG, "image/svg+xml");
    if (path === "/favicon.ico") return png(ICON_PNG_64);
    if (path === "/apple-touch-icon.png" || path === "/apple-touch-icon-precomposed.png") return png(ICON_PNG_180);
    if (path === "/icon-512.png") return png(ICON_PNG_512);
    if (path === "/manifest.webmanifest") return cached(MANIFEST, "application/manifest+json");

    if (path === "/join") {
      if (request.method === "POST") return handleJoin(request, env);
      // A failed join redirects here with a one-time flash cookie, so a refresh clears the error.
      const flash = readCookie(request, FLASH);
      const res = joinPage(env.OWNER_NAME, flash?.error ?? "");
      if (flash) res.headers.append("set-cookie", clearCookie(FLASH));
      return res;
    }

    if (path === "/join/done") {
      // The new key is shown once; refreshing doesn't re-submit the form or rotate the key.
      const done = readCookie(request, DONE);
      if (!done) return Response.redirect(`${url.origin}/join`, 303);
      const res = joinSuccess(url.origin, done.name, done.apiKey, done.meToken, done.hasPoke);
      res.headers.append("set-cookie", clearCookie(DONE));
      res.headers.append("set-cookie", rememberCookie(done.meToken));
      return res;
    }

    if (path === "/unlock" && request.method === "POST") {
      const form = await request.formData();
      const next = String(form.get("next")) === "/history" ? "/history" : "/";
      const code = await joinCode(env);
      if (!code || String(form.get("code") ?? "").trim() !== code) {
        return redirect(next, setCookie(FLASH, { error: "That's not the password." }, 60, "/"));
      }
      return redirect(next, `${GATE}=${await gateValue(code)}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`);
    }

    if (path === "/" || path === "/history") {
      // Password-protected: the join code, remembered on this phone for a year (or the private link, once opened).
      if (!(await unlocked(request, env))) {
        const flash = readCookie(request, FLASH);
        const res = lockedPage(path, flash?.error ?? "");
        if (flash) res.headers.append("set-cookie", clearCookie(FLASH, "/"));
        return res;
      }
      const owner = await db.owner(env);
      if (!owner) return Response.redirect(`${url.origin}/join`, 303);
      if (path === "/") return homePage(env, owner, await db.privateToken(env.DB, owner.id), new Date());
      return historyPage(env, owner, new Date(), url.searchParams.get("range"));
    }
    if (path === "/me") return Response.redirect(`${url.origin}/`, 303);

    // The private link: opening it remembers this phone. Its forms post here too.
    const me = path.match(/^\/me\/([\w-]+)(\/workout|\/settings)?$/);
    if (me) {
      const owner = await db.owner(env);
      if (!owner || (await db.privateToken(env.DB, owner.id)) !== me[1]) return new Response("Not found", { status: 404 });
      let anchor = "";
      if (me[2] && request.method === "POST") anchor = `#${await handlePageAction(env, owner, me[2], await request.formData(), new Date())}`;
      return redirect(`/${anchor}`, rememberCookie(me[1]));
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSchedule(env, new Date()));
  },
};

/** Buttons on the page: log or remove a workout, and goals Poke can't set without a reconnect. */
async function handlePageAction(env: Env, player: Player, action: string, form: FormData, now: Date): Promise<string> {
  const today = gameDay(now, env.GAME_TZ);
  const field = (k: string) => String(form.get(k) ?? "").trim();
  if (action === "/workout") {
    if (field("remove")) {
      await db.deleteWorkoutById(env.DB, player.id, Number(field("remove")));
    } else {
      const kind = field("kind") as WorkoutKind;
      const day = field("day") === "yesterday" ? addDays(today, -1) : today;
      if (WORKOUT_KINDS.includes(kind)) await db.saveWorkout(env.DB, player.id, { day, kind, note: field("note").slice(0, 60) || null });
    }
    return "gym";
  }
  // settings
  if (form.has("workout_target")) {
    const n = Math.round(Number(field("workout_target")));
    if (n >= 1 && n <= 7) await db.setWorkoutTarget(env.DB, player.id, n);
    return "gym";
  }
  if (field("sugar") === "off") await db.setSugarTarget(env.DB, player.id, null);
  else if (form.has("sugar_target")) {
    const n = Math.round(Number(field("sugar_target")));
    if (n >= 1 && n <= 200) await db.setSugarTarget(env.DB, player.id, n);
  }
  return "sugar";
}

function randomToken(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const ME = "hb_me";

/** True if this browser opened the owner's private link before. */
async function rememberedMe(request: Request, env: Env): Promise<boolean> {
  const token = request.headers.get("cookie")?.match(/(?:^|;\s*)hb_me=([\w-]+)/)?.[1];
  const owner = token ? await db.owner(env) : null;
  return Boolean(owner && (await db.privateToken(env.DB, owner.id)) === token);
}

const GATE = "hb_in";

/** The JOIN_CODE secret wins; otherwise the code saved in the database's settings. */
async function joinCode(env: Env): Promise<string | undefined> {
  return env.JOIN_CODE?.trim() || (await db.getSetting(env.DB, "join_code"))?.trim() || undefined;
}

/** What the "unlocked" cookie holds. Changing the join code locks every phone out again. */
async function gateValue(code: string): Promise<string> {
  return db.sha256(`health-bet-gate:${code}`);
}

async function unlocked(request: Request, env: Env): Promise<boolean> {
  if (await rememberedMe(request, env)) return true; // a phone that opened the private link
  const code = await joinCode(env);
  const got = request.headers.get("cookie")?.match(/(?:^|;\s*)hb_in=([0-9a-f]+)/)?.[1];
  return Boolean(code && got && got === (await gateValue(code)));
}

const FLASH = "hb_join_error";
const DONE = "hb_join_done";

function setCookie(name: string, value: unknown, maxAge: number, path = "/join"): string {
  const v = btoa(unescape(encodeURIComponent(JSON.stringify(value))));
  return `${name}=${v}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function clearCookie(name: string, path = "/join"): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function rememberCookie(token: string): string {
  return `${ME}=${token}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
}

function readCookie(request: Request, name: string): any {
  const raw = request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(decodeURIComponent(escape(atob(raw))));
  } catch {
    return null;
  }
}

function redirect(location: string, cookie: string): Response {
  return new Response(null, { status: 303, headers: { location, "set-cookie": cookie } });
}

/** Gets the owner a new API key and private link (or creates them, the first time). The join code is the one secret. */
async function handleJoin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData();
  const code = String(form.get("code") ?? "").trim();
  const poke = String(form.get("poke") ?? "").trim() || null;
  const fail = (error: string) => redirect("/join", setCookie(FLASH, { error }, 60));
  const expected = await joinCode(env);
  if (!expected) return fail("This app doesn't have a join code set up yet.");
  if (code !== expected) return fail("That join code isn't right.");

  const apiKey = `hb_${randomToken(24)}`;
  const meToken = randomToken(18);
  await db.joinPlayer(env.DB, env.OWNER_NAME, await db.sha256(apiKey), meToken, poke);
  const owner = (await db.owner(env))!;
  return redirect("/join/done", setCookie(DONE, { name: owner.name, apiKey, meToken, hasPoke: Boolean(owner.poke_api_key) }, 600));
}

// ---------- scheduled messages through Poke ----------

async function notify(env: Env, player: Player, text: string) {
  if (player.poke_api_key) await sendToPoke(env, player.poke_api_key, text).catch((err) => console.error("poke send failed", err));
}

export async function runSchedule(env: Env, now: Date) {
  const { hour, weekday } = localParts(now, env.GAME_TZ);
  const today = gameDay(now, env.GAME_TZ);

  const owner = await db.owner(env);
  if (!owner) return;

  if (hour === RECAP_HOUR) {
    const yesterday = addDays(today, -1);
    const start = (await trackingStart(env)) ?? "";
    if (yesterday >= start && (await db.firstTime(env.DB, `recap:${yesterday}`))) await notify(env, owner, await dayRecap(env, owner, yesterday));
    // Monday morning: the week that just ended is the one containing yesterday (Sunday).
    if (weekday === 1) {
      const lastWeek = weekStart(yesterday);
      if (yesterday >= start && (await db.firstTime(env.DB, `verdict:${lastWeek}`))) await notify(env, owner, await weekSummary(env, owner, lastWeek));
    }
  }

  if (hour === NUDGE_HOUR && owner.goal_type && (await db.firstTime(env.DB, `nudge:${today}`))) {
    await notify(env, owner, await eveningNudge(env, owner, today));
  }
}
