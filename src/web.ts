// Server-rendered pages: setup, today, history. No framework; charts are drawn by a
// small inline script from JSON embedded in the page.
import * as db from "./db";
import type { Env, Player } from "./db";
import { GOAL_NAMES, dayStats, goalStreaks, gymSentence, gymSummary, lastWeekAverages, mealTotals, todaySentence, trackingStart, weekGoals, weekNotes, type Averages, type GymSummary, type WeekGoals } from "./game";
import { EMPTY_DAY, GOAL_KEYS, calorieGoalMet, dayStatus, proteinGoalMet, scoreDay, wakeGoalMet, wakeMinutes, wakeTarget, type DayStats, type GoalStatus } from "./scoring";
import type { Workout } from "./gym";
import { addDays, gameDay, localParts, prettyClock, prettyDay, prettyDuration, prettyTime, weekDays, weekdayOf, weekStart } from "./time";

const FULL_DATE = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
};

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// The accent color, validated against each theme surface.
const ACCENT = "var(--series-1)";

const CSS = `
/* Three themes: light, dark, and ocean. With no saved pick the page follows the phone's light or
   dark setting; a pick is saved in localStorage and set as data-theme before paint.
   One accent per theme, checked for contrast on its surfaces. Status never relies on the accent
   alone: close is amber, missed is an outline, nothing logged is a faint dot. */
:root, :root[data-theme="warm"] {
  color-scheme: light;
  --sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --serif: "Newsreader", Georgia, "Times New Roman", serif;
  --page: #f4f4f2;
  --page-grad: none;
  --surface: rgba(255, 255, 255, 0.72);
  --solid: #ffffff;
  --raise: rgba(20, 24, 28, 0.045);
  --ink: #16181b;
  --ink-2: #454a51;
  --muted: #646a72;
  --grid: #e3e4e6;
  --axis: #cfd2d6;
  --ring: rgba(20, 24, 28, 0.08);
  --series-1: #2f6bd8;
  --track: #e6e8eb;
  --mixto: #0e1a30;
  --good: #16181b;
  --critical: #a35a00;
  --ascii: rgba(22, 24, 27, 0.15);
  --ascii-hi: rgba(47, 107, 216, 0.85);
  --aura-1: rgba(47, 107, 216, 0.12);
  --aura-2: rgba(40, 160, 140, 0.08);
  --blur: blur(16px) saturate(1.15);
}
:root[data-theme="black"] {
  color-scheme: dark;
  --page: #0b0c0e;
  --page-grad: none;
  --surface: rgba(22, 25, 28, 0.72);
  --solid: #16191c;
  --raise: rgba(255, 255, 255, 0.06);
  --ink: #f2f3f5;
  --ink-2: #c9cdd2;
  --muted: #9aa0a6;
  --grid: #202327;
  --axis: #30343a;
  --ring: rgba(255, 255, 255, 0.07);
  --series-1: #6aa0ff;
  --track: #24282d;
  --mixto: #ffffff;
  --good: #f2f3f5;
  --critical: #f0a34a;
  --ascii: rgba(255, 255, 255, 0.14);
  --ascii-hi: rgba(106, 160, 255, 0.9);
  --aura-1: rgba(106, 160, 255, 0.12);
  --aura-2: rgba(95, 208, 179, 0.07);
  --blur: blur(16px) saturate(1.15);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    --page: #0b0c0e; --surface: rgba(22, 25, 28, 0.72); --solid: #16191c; --raise: rgba(255, 255, 255, 0.06);
    --ink: #f2f3f5; --ink-2: #c9cdd2; --muted: #9aa0a6; --grid: #202327; --axis: #30343a; --ring: rgba(255, 255, 255, 0.07);
    --series-1: #6aa0ff; --track: #24282d; --mixto: #ffffff; --good: #f2f3f5; --critical: #f0a34a;
    --ascii: rgba(255, 255, 255, 0.14); --ascii-hi: rgba(106, 160, 255, 0.9);
    --aura-1: rgba(106, 160, 255, 0.12); --aura-2: rgba(95, 208, 179, 0.07);
  }
}
:root[data-theme="ocean"] {
  color-scheme: dark;
  --page: #0b3554;
  --page-grad: linear-gradient(170deg, #061626 0%, #0a3150 42%, #0e5470 72%, #1a7d89 100%);
  --surface: rgba(8, 26, 44, 0.62);
  --solid: #0d2b44;
  --raise: rgba(255, 255, 255, 0.07);
  --ink: #eef6fb;
  --ink-2: #bcd6e5;
  --muted: #9dbccf;
  --grid: rgba(255, 255, 255, 0.08);
  --axis: rgba(255, 255, 255, 0.18);
  --ring: rgba(255, 255, 255, 0.10);
  --series-1: #8fd3ff;
  --track: rgba(255, 255, 255, 0.10);
  --mixto: #ffffff;
  --good: #eef6fb;
  --critical: #ffc069;
  --ascii: rgba(205, 236, 246, 0.16);
  --ascii-hi: rgba(170, 236, 246, 0.95);
  --aura-1: rgba(143, 211, 255, 0.12);
  --aura-2: rgba(126, 220, 230, 0.12);
  --blur: blur(14px) saturate(1.2);
}
* { box-sizing: border-box; }
html { background: var(--page); min-height: 100%; }
/* The color lives on html only: a body background would paint over the fixed background layers. */
body { min-height: 100vh; min-height: 100dvh; margin: 0; background: transparent; color: var(--ink); font: 15px/1.45 var(--sans); }
/* Background: soft accent glows (and the ocean fade), a glow that follows the pointer, and an
   animated ASCII field drawn on a canvas (see ASCII_JS). */
body::before { content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(60vmax 45vmax at 6% -4%, var(--aura-1), transparent 70%),
    radial-gradient(60vmax 45vmax at 100% 104%, var(--aura-2), transparent 70%),
    var(--page-grad);
}
:root { --mx: 6vw; --my: -4vh; }
.spot { position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background: radial-gradient(420px 420px at var(--mx) var(--my), var(--aura-1), transparent 70%); }
canvas.ascii { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: -1; pointer-events: none;
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.15) 100%);
  mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.15) 100%); }
@media (prefers-reduced-motion: reduce) { .spot { display: none; } }
.card, .pcard, .face, .banner, .private-note, nav .links, .themes, .go, .chips a {
  -webkit-backdrop-filter: var(--blur); backdrop-filter: var(--blur);
  box-shadow: inset 0 0 0 1px var(--ring), 0 1px 2px rgba(0, 0, 0, 0.03);
}
.brand { display: flex; align-items: center; gap: 14px; }
.wordmark { font: 700 19px/1 var(--sans); margin: 0; letter-spacing: -0.01em; color: var(--ink); }
.themes { display: inline-flex; gap: 6px; padding: 5px; border-radius: 999px; background: var(--surface); }
.themes button { width: 20px; height: 20px; margin: 0; padding: 0; border-radius: 50%; cursor: pointer; border: 1px solid var(--axis); }
.themes button[data-t="warm"] { background: #f4f4f2; }
.themes button[data-t="black"] { background: #0b0c0e; }
.themes button[data-t="ocean"] { background: linear-gradient(160deg, #061626, #0e5470 60%, #1a7d89); }
.themes button[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.themes button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.topbar { margin: 0 0 18px; }
.onboard .title.wordmark { font: 700 40px/1.1 var(--sans); letter-spacing: -0.02em; }
main { max-width: 760px; margin: 0 auto; padding-block: 18px 56px; padding-inline: 16px; }
a { color: inherit; }
h1 { font: 700 19px/1.1 var(--sans); margin: 0; }
h2 { font: 600 16px/1.2 var(--sans); color: var(--ink-2); margin: 26px 4px 10px; }
h3 { font: 700 15px/1.2 var(--sans); margin: 0; }
.big, .v { font-weight: 700; font-variant-numeric: tabular-nums; }
nav { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 18px; }
nav h1 { font: 700 19px/1 var(--sans); letter-spacing: -0.01em; }
nav .links { display: flex; background: var(--surface); border-radius: 999px; padding: 3px; }
nav .links a { color: var(--muted); text-decoration: none; padding: 6px 12px; border-radius: 999px; font-size: 13px; font-weight: 600; }
nav .links a[aria-current] { color: var(--ink); background: var(--raise); }
.card { background: var(--surface); border-radius: 22px; padding: 16px; }
.muted { color: var(--muted); }
.sub { color: var(--ink-2); }
.date { display: flex; justify-content: space-between; font-size: 12px; font-weight: 600; color: var(--muted); margin: 0 4px 10px; }
.faces { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.face { background: var(--surface); border-radius: 26px; padding: 16px 12px 14px; text-align: center; min-width: 0; }
.face svg { width: 100%; max-width: 150px; height: auto; display: block; margin: 0 auto; }
.face .n { font-weight: 700; font-size: 13px; margin-top: 8px; }
.face .d { font-size: 12px; color: var(--muted); margin-top: 2px; }
.week7 { display: flex; flex-direction: column; justify-content: flex-end; }
.wds { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; flex: 1; align-items: end; max-width: 220px; width: 100%; margin: 0 auto; }
.wd { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 0; }
.wd .wb { width: 100%; max-width: 18px; height: 84px; border-radius: 6px; background: var(--raise); display: flex; align-items: flex-end; overflow: hidden; }
.wd .wb span { display: block; width: 100%; border-radius: 6px; background: var(--series-1); }
.wd b { font-size: 13px; font-variant-numeric: tabular-nums; }
.wd small { font-size: 10px; color: var(--muted); font-weight: 600; }
.wd.now small { color: var(--ink); }
.week7 .n { font-size: 15px; margin-top: 10px; }
.swatch { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; vertical-align: 1px; }
.banner { margin-top: 10px; padding: 12px 16px; border-radius: 18px; background: var(--surface); font-size: 14px; color: var(--ink-2); }
.banner strong { color: var(--ink); }
.players { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; }
.pcard { background: var(--surface); border-radius: 22px; padding: 14px; }
.pcard .head { display: flex; justify-content: space-between; align-items: baseline; margin: 0 2px 12px; }
.pcard .head .t { font-size: 13px; color: var(--muted); font-weight: 600; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; border-radius: 16px; overflow: hidden; }
.stat { background: var(--raise); padding: 10px 12px 11px; min-width: 0; }
.stat .k { font-size: 13px; color: var(--muted); font-weight: 600; }
.stat .v { font-size: 26px; line-height: 1.15; }
.stat .v small { font-size: 13px; color: var(--muted); font-weight: 500; letter-spacing: 0; }
.stat .s { font-size: 12px; font-weight: 600; color: var(--muted); }
.stat.wide { grid-column: 1 / -1; }
.stat .v .of { font-size: 18px; color: var(--ink-2); margin-left: 8px; }
.ok { color: var(--good); font-weight: 700; }
.ok::before { content: "✓ "; }
.bad { color: var(--critical); font-weight: 700; }
.bad::before { content: "▲ "; font-size: 0.85em; }
table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--grid); font-size: 14px; white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
@media (max-width: 480px) { th, td { padding: 9px 4px; } .wk th.n, .wk td.n { padding: 9px 3px; } }
th { color: var(--muted); font-weight: 600; font-size: 13px; }
td.n, th.n { text-align: right; }
td.p4 { color: var(--ink); font-weight: 800; text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 4px; }
.wk td.n { font-weight: 700; font-size: 16px; }
.table-wrap { overflow-x: auto; }
.gym-row + .gym-row { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--grid); }
.gym-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 0 2px 8px; }
.gym-head h3 { margin: 0; font-size: 15px; }
.gym-head .t { font-size: 13px; color: var(--muted); font-weight: 600; }
.gym-head .t span { white-space: nowrap; }
.gym-scroll { overflow-x: auto; padding-bottom: 2px; }
.gym-grid { display: grid; grid-template-rows: 14px repeat(7, 13px); grid-template-columns: 26px; grid-auto-flow: column; grid-auto-columns: 13px; gap: 3px; width: max-content; }
.gym-grid .dl, .gym-grid .ml { font-size: 10px; line-height: 13px; color: var(--muted); white-space: nowrap; }
.gym-grid .dl { font-size: 9px; }
.gym-grid .ml { overflow: visible; }
.gym-grid .c { margin: 0; border-radius: 3px; background: var(--raise); padding: 0; border: 0; cursor: pointer; }
.gym-grid .c.on1 { background: color-mix(in srgb, var(--gc) 55%, transparent); }
.gym-grid .c.on2 { background: var(--gc); }
.gym-key { display: flex; flex-wrap: wrap; gap: 4px 14px; }
.gym-key span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.gym-key i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; background: var(--raise); }
.gym-grid .c.future { background: transparent; box-shadow: inset 0 0 0 1px var(--grid); cursor: default; }
.gym-grid button.c:hover { box-shadow: inset 0 0 0 1.5px var(--ink-2); }
.gym-grid .c.today { outline: 1.5px solid var(--ink-2); outline-offset: 1px; }
.gym-grid .c:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }
.gym-wk .c { display: inline-block; width: 18px; height: 18px; margin: 0; padding: 0; border: 0; border-radius: 5px; background: var(--raise); cursor: pointer; vertical-align: middle; }
.gym-wk .c.on1 { background: color-mix(in srgb, var(--gc) 55%, transparent); }
.gym-wk .c.on2 { background: var(--gc); }
.gym-wk .c.future { background: transparent; box-shadow: inset 0 0 0 1px var(--grid); }
.gym-wk .c.today { outline: 1.5px solid var(--ink-2); outline-offset: 2px; }
.gym-wk .c:hover { box-shadow: inset 0 0 0 1.5px var(--ink-2); }
.gym-wk td.n small { font-size: 12px; color: var(--muted); font-weight: 600; }
.streak { font-size: 12px; color: var(--muted); font-weight: 600; }
.gym-tip { font-size: 12px; color: var(--ink-2); min-height: 16px; margin: 6px 2px 0; }
.rules { color: var(--muted); font-size: 12px; margin: 10px 2px 0; }
.meal { padding: 12px 2px; border-bottom: 1px solid var(--grid); }
.meal:first-child { padding-top: 2px; }
.meal:last-child { border-bottom: 0; padding-bottom: 2px; }
.meal ul { margin: 6px 0 0; padding-left: 16px; color: var(--ink-2); font-size: 14px; }
.meal ul .muted { font-variant-numeric: tabular-nums; }
.meal .tot { font-variant-numeric: tabular-nums; color: var(--ink-2); font-size: 14px; margin-top: 2px; }
.meal-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; font-weight: 700; }
.meal-head form, .day-head form { margin: 0; }
.gym-log .seg { display: inline-flex; background: var(--raise); border-radius: 999px; padding: 3px; margin-bottom: 10px; }
.gym-log .seg label { margin: 0; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; }
.gym-log .seg input { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
.gym-log .seg label:has(input:checked) { background: var(--surface); color: var(--ink); }
.gym-log .kinds { display: flex; gap: 8px; flex-wrap: wrap; }
.gym-log .kinds .pill { padding: 12px 18px; font-size: 15px; }
.wlist { list-style: none; padding: 0; margin: 12px 0 0; }
.wlist li { display: flex; justify-content: space-between; align-items: center; padding: 6px 2px; border-top: 1px solid var(--grid); font-size: 14px; }
form.inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 12px; font-size: 13px; }
form.inline select, form.inline input { width: auto; padding: 6px 10px; border-radius: 10px; font-size: 14px; }
form.inline input[type=number] { width: 70px; }
form.inline .wk-line { flex-basis: 100%; }
.card.offer { box-shadow: inset 0 0 0 1.5px var(--ink-2); }
.pill, .meal-head button, .day-head button { margin: 0; padding: 6px 14px; font: 600 13px/1 var(--sans); border-radius: 999px; border: 0; background: var(--raise); color: var(--ink); cursor: pointer; }
.day-head button { background: var(--ink); color: var(--page); }
.meal-head button:hover, .day-head button:hover { filter: brightness(1.15); }
.day-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; margin: 26px 4px 10px; }
.day-head h2 { margin: 0; }
.chip { font-size: 13px; font-weight: 600; padding: 2px 8px; border-radius: 999px; background: var(--raise); color: var(--ink-2); margin-left: 6px; }
.chip.on { color: var(--ink); background: var(--axis); }
.private-note { margin: 0 0 12px; padding: 12px 16px; border-radius: 18px; background: var(--surface); color: var(--ink-2); font-size: 14px; }
.chips { display: flex; gap: 6px; }
.chips a { padding: 6px 14px; border-radius: 999px; text-decoration: none; color: var(--muted); background: var(--surface); font-size: 13px; font-weight: 600; }
.chips a[aria-current] { color: var(--page); background: var(--ink); }
.rates-row + .rates-row { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--grid); }
.rates-row h3 { font-size: 14px; margin: 0 2px 8px; }
.rates { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; border-radius: 14px; overflow: hidden; }
.rate { background: var(--raise); padding: 8px 10px 10px; min-width: 0; }
.rate .rk { font-size: 11px; color: var(--muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rate .rv { font-size: 22px; line-height: 1.2; font-weight: 600; }
.rate .rv small { font-size: 12px; color: var(--muted); }
.rbar { height: 4px; border-radius: 2px; background: var(--grid); overflow: hidden; margin-top: 4px; }
.rbar span { display: block; height: 100%; border-radius: 2px; }
.days { padding: 6px 12px 12px; }
.days .dhead, .drow > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; }
.days.one .dhead, .days.one .drow > summary { grid-template-columns: 1fr auto; }
.days .dhead { font-size: 13px; font-weight: 600; color: var(--ink-2); padding: 8px 2px; }
.days .dhead > span:not(:first-child) { width: 104px; }
.drow { margin: 0; border-top: 1px solid var(--grid); }
.drow > summary { list-style: none; padding: 9px 2px; color: var(--ink); font-size: 14px; }
.drow > summary::-webkit-details-marker { display: none; }
.drow .dd { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 420px) { .drow .dd small { display: none; } }
.dp { display: inline-flex; align-items: center; gap: 2px; width: 104px; }
.dp b { margin-left: auto; font-size: 15px; }
.gi { display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; font-size: 12px; line-height: 1; filter: grayscale(1); opacity: 0.25; }
.gi.hit { filter: none; opacity: 1; background: color-mix(in srgb, var(--gc) 32%, transparent); }
.ddet { padding: 0 2px 10px; font-size: 13px; color: var(--ink-2); }
.ddet p { margin: 4px 0; }
.trends { margin: 16px 0 0; }
.trends > summary { list-style: none; display: inline-block; padding: 8px 16px; border-radius: 999px; background: var(--surface); color: var(--ink); font-weight: 600; font-size: 14px; }
.trends > summary::-webkit-details-marker { display: none; }
.trends[open] > summary { margin-bottom: 10px; }
.tgrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr)); gap: 10px; }
.tgrid > * { min-width: 0; }
.tcard h3 { font-size: 14px; margin: 0 2px 10px; }
.tcols { display: grid; gap: 14px; grid-template-columns: minmax(0, 1fr); }
.tcols.n2 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
.tlabel { font-size: 12px; font-weight: 600; margin: 0 0 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
svg.bars { display: block; width: 100%; height: auto; overflow: visible; border-bottom: 1px solid var(--axis); }

.cbox { position: relative; }
svg.bars .zone { fill: var(--ink-2); opacity: 0.07; }
.glabel { position: absolute; right: 0; transform: translateY(-115%); font-size: 11px; font-weight: 700; color: var(--ink-2); background: var(--solid); padding: 1px 6px; border-radius: 6px; pointer-events: none; white-space: nowrap; }
svg.bars .goal { stroke: var(--ink-2); stroke-width: 1.5; stroke-dasharray: 4 3; opacity: 0.7; vector-effect: non-scaling-stroke; }
.xaxis { display: flex; justify-content: space-between; font-size: 11px; color: var(--muted); margin-top: 4px; }
.tip-out { font-size: 12px; color: var(--ink-2); min-height: 16px; margin: 8px 2px 0; }
.empty-chart { font-size: 13px; margin: 20px 0; }
details { margin: 10px 4px 0; }
summary { cursor: pointer; color: var(--muted); font-size: 13px; }
form label { display: block; margin: 14px 0 6px; font-size: 13px; font-weight: 600; color: var(--muted); }
input { width: 100%; padding: 12px 14px; font: inherit; border-radius: 14px; border: 1px solid var(--axis); background: var(--raise); color: var(--ink); }
input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
button { margin-top: 20px; padding: 12px 22px; font: 700 15px/1 var(--sans); border-radius: 999px; border: 0; background: var(--ink); color: var(--page); cursor: pointer; }
code, .key { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.key { display: block; padding: 12px 14px; border-radius: 14px; background: var(--raise); word-break: break-all; user-select: all; }
.steps h3 { margin-top: 18px; }
.steps h3:first-child { margin-top: 0; }
ol li { margin-bottom: 8px; }
.error { color: var(--critical); font-weight: 600; }
/* Onboarding (join + you're in): one narrow column, like a phone even on a laptop. */
main.narrow { max-width: 460px; padding-block: 48px 64px; }
.onboard { text-align: center; margin-bottom: 22px; }
.onboard .mark { width: 64px; height: 40px; display: block; margin: 0 auto 14px; }
.onboard .title { margin: 0; font-size: 36px; text-align: center; text-transform: none; letter-spacing: 0; }
.onboard .lede { margin: 8px auto 0; text-align: center; max-width: 34ch; }
.form { padding: 20px; border-radius: 26px; }
.form label:first-of-type { margin-top: 0; }
.form input[type="text"], .form input:not([type]) { padding: 13px 14px; }
.form input::placeholder { color: var(--muted); }
.tiles { border: 0; padding: 0; margin: 18px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.tiles legend { font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 6px; padding: 0; }
.tile { position: relative; margin: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 10px 12px; border-radius: 20px;
  background: var(--raise); cursor: pointer; font-size: 14px; font-weight: 700; letter-spacing: 0; text-transform: none; color: var(--ink); }
.tile input { position: absolute; opacity: 0; inset: 0; margin: 0; cursor: pointer; }
.tile svg { width: 48px; height: 48px; }
.who-tiles { margin: 0; }
button.tile { margin: 0; border: 0; font: 700 16px/1.2 var(--sans); padding: 20px 10px 16px; }
button.tile:hover { box-shadow: inset 0 0 0 2px var(--ink); }
.tile:has(input:checked) { box-shadow: inset 0 0 0 2px var(--ink); }
.tile:has(input:focus-visible) { outline: 2px solid var(--ink); outline-offset: 2px; }
.opt { margin: 18px 0 0; }
.opt summary { list-style: none; cursor: pointer; font-size: 14px; color: var(--ink-2); padding: 12px 14px; border-radius: 14px; background: var(--raise); }
.opt summary::-webkit-details-marker { display: none; }
.opt summary span { color: var(--ink); font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.opt[open] summary { margin-bottom: 10px; }
.hint { color: var(--muted); font-size: 13px; margin: 6px 2px 0; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
button.wide { width: 100%; margin-top: 20px; padding: 15px; font-size: 16px; }
.foot { color: var(--muted); font-size: 13px; text-align: center; margin: 16px 12px 0; }
.steps { list-style: none; counter-reset: step; padding: 6px 20px; border-radius: 26px; margin: 0; }
.steps > li { counter-increment: step; padding: 16px 0 16px 40px; position: relative; border-bottom: 1px solid var(--grid); margin: 0; }
.steps > li:last-child { border-bottom: 0; }
.steps > li::before { content: counter(step); position: absolute; left: 0; top: 15px; width: 26px; height: 26px; border-radius: 50%;
  background: var(--ink); color: var(--page); font-weight: 800; font-size: 13px; display: grid; place-items: center; }
.steps h3 { font-size: 16px; }
.steps .field { margin: 12px 2px 0; font-size: 13px; font-weight: 600; color: var(--muted); }
.copy { display: flex; gap: 8px; align-items: center; margin-top: 8px; padding: 6px 6px 6px 12px; border-radius: 14px; background: var(--raise); }
.copy code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 13px; }
.copy .pill { flex: none; background: var(--ink); color: var(--page); }
.links2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; }
.go { display: block; padding: 16px; border-radius: 22px; background: var(--surface); text-decoration: none; }
.go b { display: block; font-size: 16px; }
.go span { display: block; color: var(--muted); font-size: 13px; margin-top: 4px; }
.go:hover { background: var(--raise); }
fieldset.colors { border: 0; padding: 0; margin: 14px 0 0; display: flex; gap: 8px; flex-wrap: wrap; }
fieldset.colors legend { font-size: 13px; font-weight: 600; color: var(--muted); margin-bottom: 6px; padding: 0; }
fieldset.colors label { margin: 0; display: flex; align-items: center; gap: 4px; padding: 10px 16px; border-radius: 999px; background: var(--raise);
  font-size: 14px; letter-spacing: 0; text-transform: none; color: var(--ink); font-weight: 600; cursor: pointer; }
fieldset.colors input { width: auto; margin: 0 6px 0 0; accent-color: var(--ink); }
fieldset.colors label:has(input:checked) { box-shadow: inset 0 0 0 2px var(--ink); }
.lede { color: var(--ink-2); margin: 8px 4px 16px; }
.title { font: 800 28px/1.1 var(--sans); margin: 6px 4px 0; }
/* Today */
.small { font-size: 13px; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin: 0 2px 14px; }
.row h3 { margin: 0; }
main > section + section, main > section + .tiles2 { margin-top: 12px; }
.intro { margin: 4px 4px 18px; }
.eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.prose { font-family: var(--serif); color: var(--ink); margin: 0; }
.prose.big { font-size: 24px; line-height: 1.36; max-width: 36ch; }
.prose.note { font-size: 18px; line-height: 1.45; color: var(--ink-2); margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--grid); }
.card.rings { display: flex; align-items: center; gap: 20px; padding: 18px; }
.rings svg { width: 168px; height: 168px; flex: none; }
.rlegend { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.rl { display: flex; gap: 8px; align-items: flex-start; }
.rl i { flex: none; width: 10px; height: 10px; border-radius: 50%; margin-top: 4px; }
.rl .rk { font-size: 12px; color: var(--muted); }
.rl .rv { font-size: 15px; font-weight: 600; font-variant-numeric: tabular-nums; }
@media (max-width: 380px) { .card.rings { flex-direction: column; } }
.tiles2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
@media (min-width: 640px) { .tiles2 { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.tile2 { padding: 14px 16px; border-radius: 18px; }
.tile2 .k { font-size: 12px; color: var(--muted); font-weight: 500; }
.tile2 .v { font-size: 30px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.2; font-variant-numeric: tabular-nums; }
.tile2 .v small { font-size: 14px; color: var(--muted); font-weight: 500; margin-left: 2px; }
.tile2 .s { font-size: 12px; font-weight: 600; color: var(--muted); }
.tile2 .ok { color: var(--series-1); }
.tile2 .ok::before { content: none; }
.macros { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; font-size: 13px; color: var(--muted); margin: 10px 6px 12px; }
.sm { display: inline-block; box-sizing: border-box; width: 18px; height: 18px; border-radius: 5px; vertical-align: middle; }
.s-hit { background: var(--series-1); }
.s-near { border: 3px solid var(--critical); }
.s-miss { border: 1.5px solid var(--muted); }
.s-none { width: 5px; height: 5px; border-radius: 50%; background: var(--axis); }
.s-now { border: 1.6px dashed var(--series-1); }
.s-future { width: 5px; height: 5px; border-radius: 50%; background: transparent; }
.wgrid { display: grid; grid-template-columns: 84px repeat(7, minmax(0, 1fr)) 36px; gap: 9px 4px; align-items: center; font-size: 13px; }
.wgrid .dh, .wday .dh { text-align: center; font-size: 11px; color: var(--muted); }
.dh.now { color: var(--ink); font-weight: 700; }
.wgrid .cell { display: flex; justify-content: center; }
.wgrid .gn { color: var(--ink-2); }
.wgrid .gc { text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.skey { display: flex; flex-wrap: wrap; gap: 6px 14px; }
.skey span { display: inline-flex; align-items: center; gap: 6px; }
.skey .sm { width: 11px; height: 11px; border-radius: 3px; }
.skey .s-near { border-width: 2px; }
.skey .s-none { width: 5px; height: 5px; }
.card h3 { margin: 0 2px 12px; }
.avgs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0 2px; }
.avgs .k { font-size: 11px; color: var(--muted); font-weight: 500; }
.avgs .v { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; }
.wstrip { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px; }
.wday { display: flex; flex-direction: column; gap: 6px; }
.wbar { display: block; height: 28px; border-radius: 8px; background: var(--raise); }
.wbar.on1 { background: color-mix(in srgb, var(--series-1) 60%, transparent); }
.wbar.on2 { background: var(--series-1); }
.wbar.future { background: transparent; box-shadow: inset 0 0 0 1px var(--grid); }
.gym-log .prose.note { margin-bottom: 14px; }
.meal-head .tot { margin: 0; font-weight: 500; }
.days .dhead .dl { width: 18px; text-align: center; font-size: 10px; }
.days .dp { width: auto; gap: 6px; }
.days.one .dhead { grid-template-columns: 1fr auto; }
.rate .rk + .rk { margin-top: 4px; }
`;

const THEMES = `<div class="themes" role="group" aria-label="Theme">
  <button type="button" data-t="warm" aria-label="Light theme" title="Light"></button>
  <button type="button" data-t="black" aria-label="Dark theme" title="Dark"></button>
  <button type="button" data-t="ocean" aria-label="Ocean theme" title="Ocean"></button></div>`;

const THEME_COLORS = { warm: "#f4f4f2", black: "#0b0c0e", ocean: "#0b3554" };

// Runs before paint so the saved theme never flashes the default.
const THEME_BOOT = `<script>try{var t=localStorage.getItem("hb-theme"),c=${JSON.stringify(THEME_COLORS)};if(t&&c[t]){document.documentElement.dataset.theme=t;document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.content=c[t]})}}catch(e){}</script>`;

const THEME_JS = `<script>
(() => {
  const colors = ${JSON.stringify(THEME_COLORS)};
  const current = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "black" : "warm");
  const sync = () => {
    const t = current();
    document.querySelectorAll(".themes button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.t === t)));
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => { m.content = colors[t]; });
  };
  document.querySelectorAll(".themes button").forEach((b) => b.addEventListener("click", () => {
    document.documentElement.dataset.theme = b.dataset.t;
    try { localStorage.setItem("hb-theme", b.dataset.t); } catch (e) {}
    sync();
  }));
  sync();

  // Ease the glow toward the pointer (mouse, pen, or a dragging finger).
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const root = document.documentElement.style;
    let x = innerWidth * 0.06, y = -innerHeight * 0.04, tx = x, ty = y, raf = 0;
    const step = () => {
      x += (tx - x) * 0.12; y += (ty - y) * 0.12;
      root.setProperty("--mx", x.toFixed(1) + "px"); root.setProperty("--my", y.toFixed(1) + "px");
      raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.5 ? requestAnimationFrame(step) : 0;
    };
    addEventListener("pointermove", (e) => { tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(step); }, { passive: true });
  }
})();
</script>`;

// Animated ASCII background: a character grid whose density comes from one of four fields
// (waves, ripples, swirl, plasma) that crossfade every ~18s, plus a bloom around the pointer.
// ~30fps, paused when hidden, a single still frame with reduced motion.
const ASCII_JS = `<script>
(() => {
  const cv = document.querySelector("canvas.ascii"); if (!cv) return;
  const ctx = cv.getContext("2d");
  const RAMP = " .·:-=+*#%";
  const CW = 7, CH = 10;
  let W = 0, H = 0, cols = 0, rows = 0, dpr = 1, base = "", hi = "";
  const css = () => { const st = getComputedStyle(document.documentElement); base = st.getPropertyValue("--ascii").trim(); hi = st.getPropertyValue("--ascii-hi").trim(); };
  const size = () => {
    dpr = Math.min(devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "8px ui-monospace, SFMono-Regular, Menlo, monospace"; ctx.textBaseline = "top";
    cols = Math.ceil(W / CW) + 1; rows = Math.ceil(H / CH) + 1;
  };
  const fields = [
    (x, y, t) => 0.5 + 0.25 * Math.sin(x * 0.16 + t * 0.9) + 0.25 * Math.sin(y * 0.22 - t * 0.7 + x * 0.05),               // waves
    (x, y, t) => { const d = Math.hypot(x - cols * 0.5, (y - rows * 0.4) * 1.6); return 0.5 + 0.5 * Math.sin(d * 0.35 - t * 1.6); }, // ripples
    (x, y, t) => { const dx = x - cols * 0.5, dy = (y - rows * 0.45) * 1.6; return 0.5 + 0.5 * Math.sin(Math.atan2(dy, dx) * 3 + Math.hypot(dx, dy) * 0.12 - t); }, // swirl
    (x, y, t) => 0.5 + 0.25 * Math.sin(x * 0.11 + t) + 0.25 * Math.sin(Math.hypot(x * 0.5 - 20 + 8 * Math.sin(t * 0.3), y - 10) * 0.25 + t * 0.6), // plasma
  ];
  // The highlight trails the pointer (eased each frame) and fades in and out instead of switching.
  let px = -9999, py = -9999, ex = -9999, ey = -9999, strength = 0, target = 0;
  addEventListener("pointermove", (e) => { px = e.clientX; py = e.clientY; target = 1; if (ex < -999) { ex = px; ey = py; } }, { passive: true });
  document.addEventListener("pointerleave", () => { target = 0; });
  const PERIOD = 18, FADE = 3;
  // Draw characters at fixed cell positions so the monospace grid stays aligned.
  const draw = (ms) => {
    const t = ms / 1000;
    const k = Math.floor(t / PERIOD) % fields.length, next = (k + 1) % fields.length;
    const into = t % PERIOD, mix = into > PERIOD - FADE ? (into - (PERIOD - FADE)) / FADE : 0;
    const f = fields[k], g = fields[next];
    ctx.clearRect(0, 0, W, H);
    ex += (px - ex) * 0.07; ey += (py - ey) * 0.07; strength += (target - strength) * 0.05;
    const pcx = ex / CW, pcy = ey / CH;
    const R2 = 2 * 14 * 14; // soft falloff, ~100px radius
    ctx.fillStyle = base;
    const glow = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let v = f(c, r, t) * (1 - mix) + g(c, r, t) * mix;
        const bloom = strength * Math.exp(-((c - pcx) ** 2 + ((r - pcy) * 1.4) ** 2) / R2);
        v = Math.min(1, v * 0.88 + bloom * 0.22);
        if (v < 0.42) continue;
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(((v - 0.42) / 0.58) * RAMP.length))];
        ctx.fillText(ch, c * CW, r * CH);
        if (bloom > 0.04) glow.push(c, r, bloom, ch);
      }
    }
    // Tint near the pointer, blended by distance rather than a hard switch.
    ctx.fillStyle = hi;
    for (let i = 0; i < glow.length; i += 4) {
      ctx.globalAlpha = Math.min(1, glow[i + 2] * 0.45);
      ctx.fillText(glow[i + 3], glow[i] * CW, glow[i + 1] * CH);
    }
    ctx.globalAlpha = 1;
  };
  css(); size();
  addEventListener("resize", size);
  document.querySelectorAll(".themes button").forEach((b) => b.addEventListener("click", () => requestAnimationFrame(css)));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) { draw(4000); return; }
  let last = 0;
  const loop = (ms) => { if (!document.hidden && ms - last > 33) { last = ms; draw(ms); } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();
</script>`;

function layout(title: string, body: string, script = "", mainClass = ""): Response {
  // Pages with a nav carry the switcher there; the rest get it alone at the top left.
  if (!body.includes("<nav>")) body = `<div class="topbar">${THEMES}</div>${body}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title === "Health" ? title : `${title} · Health`)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="Health"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#f4f4f2" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#0b0c0e" media="(prefers-color-scheme: dark)">${THEME_BOOT}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400..800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap">
<style>${CSS}</style></head>
<body><canvas class="ascii" aria-hidden="true"></canvas><div class="spot" aria-hidden="true"></div><main${mainClass ? ` class="${mainClass}"` : ""}>${body}</main>${script}${THEME_JS}${ASCII_JS}</body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function nav(current: "today" | "history"): string {
  const cur = (k: string) => (current === k ? 'aria-current="page"' : "");
  return `<nav><div class="brand">${THEMES}<h1>Health</h1></div><div class="links">
    <a href="/" ${cur("today")}>Today</a>
    <a href="/history" ${cur("history")}>History</a></div></nav>`;
}

const SLOTS = ["Breakfast", "Lunch", "Dinner", "Snack"] as const;

/** Breakfast, Lunch, Dinner, or Snack: the agent's label when it's one of those, otherwise from when it was logged. */
export function mealSlot(name: string | null, createdAt: string, tz: string): string {
  const named = SLOTS.find((x) => name && new RegExp(`\\b${x}\\b`, "i").test(name)) ?? (name && /\bbrunch\b/i.test(name) ? "Brunch" : undefined);
  if (named) return named;
  const h = localParts(new Date(`${createdAt.replace(" ", "T")}Z`), tz).hour;
  return h >= 4 && h < 11 ? "Breakfast" : h >= 11 && h < 15 ? "Lunch" : h >= 17 && h < 22 ? "Dinner" : "Snack";
}

function mealBlock(m: db.MealWithItems, sugar: boolean, tz: string): string {
  const t = mealTotals(m);
  const when = prettyTime(`${m.created_at.replace(" ", "T")}Z`, tz).toLowerCase().replace(" ", "");
  const item = (it: db.FoodEntry) =>
    `<li>${esc(it.description)} <span class="muted">(${it.calories} cal, ${it.protein_g}g P, ${it.fat_g}g F, ${it.carbs_g}g C${sugar && it.sugar_g != null ? `, ${it.sugar_g}g sugar${it.added_sugar_g ? ` (${it.added_sugar_g}g added)` : ""}` : ""})</span></li>`;
  return `<div class="meal"><div class="meal-head"><div>${mealSlot(m.name, m.created_at, tz)} <span class="muted small">· ${when}</span></div><div class="tot">${fmt(t.calories)} cal · ${t.protein} g protein</div></div>
    <ul>${m.items.map(item).join("")}</ul></div>`;
}

// ---------- setup ----------

/** A ring, three-quarters closed: the mark for the setup pages. */
const MARK = `<svg class="mark" viewBox="0 0 40 40" aria-hidden="true">
  <circle cx="20" cy="20" r="15" fill="none" stroke="var(--raise)" stroke-width="5"/>
  <circle cx="20" cy="20" r="15" fill="none" stroke="var(--series-1)" stroke-width="5" stroke-linecap="round" stroke-dasharray="70 100" transform="rotate(-90 20 20)"/>
</svg>`;

export function joinPage(name: string, error = ""): Response {
  return layout(
    "Set up",
    `<header class="onboard">${MARK}<h1 class="title">Set up</h1>
      <p class="lede">Food, sleep, and wake-up.<br>Four goals a day.</p></header>
    <form method="post" class="card form">
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <label for="code">Join code</label><input id="code" name="code" required autocomplete="off" autocapitalize="off" placeholder="The JOIN_CODE secret">
      <details class="opt"><summary>Want recap texts from Poke? <span>Add your Poke API key</span></summary>
        <label for="poke" class="sr">Poke API key</label>
        <input id="poke" name="poke" autocomplete="off" placeholder="Paste a key from Poke Kitchen → API Keys">
        <p class="hint">Gets you a 10am recap, a 9pm check-in, and a Monday week summary by text.</p>
      </details>
      <button type="submit" class="wide">Get a key for ${esc(name)}</button>
    </form>
    <p class="foot">Lost your key? Do this again. You'll get a new key, and the old one stops working.</p>`,
    "",
    "narrow",
  );
}

const COPY_JS = `<script>
document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
  const el = document.getElementById(b.dataset.copy);
  try { await navigator.clipboard.writeText(el.textContent.trim()); b.textContent = "Copied"; }
  catch { const r = document.createRange(); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); b.textContent = "Selected"; }
  setTimeout(() => (b.textContent = "Copy"), 1600);
}));
</script>`;

export function joinSuccess(origin: string, name: string, apiKey: string, meToken: string, hasPoke: boolean): Response {
  const mcpUrl = `${origin}/mcp`;
  const copyRow = (id: string, value: string) =>
    `<div class="copy"><code id="${id}">${esc(value)}</code><button type="button" class="pill" data-copy="${id}">Copy</button></div>`;
  return layout(
    "You're in",
    `<header class="onboard">${MARK}<h1 class="title">You're in, ${esc(name)}</h1>
      <p class="lede">Three steps and you're logging.</p></header>
    <ol class="card steps">
      <li><h3>Save your key</h3><p class="hint">It's only shown this once. Keep it in your notes app.</p>${copyRow("key", apiKey)}</li>
      <li><h3>Connect Poke</h3><p class="hint">Open <a href="https://poke.com/integrations/new">poke.com/integrations/new</a>, name it <b>Health</b>, and paste:</p>
        <p class="field">MCP Server URL</p>${copyRow("mcp", mcpUrl)}
        <p class="field">API Key</p><p class="hint">Your key from step 1.</p></li>
      <li><h3>Start texting Poke</h3><p class="hint">Set your goal first, like <em>"set my goal: cut, 1700 cal, 120g protein, 45g fat"</em>. Then text it what you eat, "gn" when you go to bed, and "gm" when you wake up.</p></li>
    </ol>
    ${hasPoke ? "" : `<p class="foot">You skipped reminders, so the app won't text you recaps. Logging by texting Poke still works. To add reminders later, set up again.</p>`}
    <div class="links2">
      <a class="go" href="/me/${esc(meToken)}"><b>Today</b><span>Opens your page and remembers this phone.</span></a>
      <a class="go" href="/history"><b>History</b><span>Every day since you started.</span></a>
    </div>
    <p class="foot">Lost the link? Ask Poke "what's my page?"</p>`,
    COPY_JS,
    "narrow",
  );
}

// ---------- today ----------

const hm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;
const shortDur = (min: number) => (min % 60 === 0 ? `${min / 60}h` : min < 60 ? `${min} min` : prettyDuration(min));
const ST_WORDS: Record<GoalStatus, string> = { hit: "hit", near: "close", miss: "missed", none: "nothing logged", now: "in progress" };

/** One square in a goal grid: filled = hit, amber ring = close, outline = missed, faint dot = nothing logged, dashed = today so far. */
function mark(st: GoalStatus, tip: string): string {
  return `<span class="sm s-${st}" role="img" aria-label="${esc(tip)}" title="${esc(tip)}" data-tip="${esc(tip)}"></span>`;
}

const STATUS_KEY = `<p class="rules skey"><span><i class="sm s-hit"></i>hit</span><span><i class="sm s-near"></i>close</span><span><i class="sm s-miss"></i>missed</span><span><i class="sm s-none"></i>nothing logged</span></p>`;

/** Four concentric rings, outside in: calories, protein, sleep, up on time. Each fills toward its goal. */
function rings(env: Env, p: Player, s: DayStats, day: string, today: string): string {
  const r = db.rules(env);
  const st = dayStatus(p, s, r, day, today);
  const cut = p.goal_type === "cut";
  const over = cut && p.calorie_target != null && st.cal !== "now" && st.cal !== "hit" && st.cal !== "none";
  const items = [
    {
      name: "Calories",
      pct: p.calorie_target ? s.calories / p.calorie_target : 0,
      text: p.calorie_target ? `${fmt(s.calories)} of ${fmt(p.calorie_target)}` : `${fmt(s.calories)}`,
      warn: over,
    },
    { name: "Protein", pct: p.protein_target ? s.protein / p.protein_target : 0, text: p.protein_target ? `${s.protein} of ${p.protein_target} g` : `${s.protein} g`, warn: false },
    { name: "Sleep", pct: s.sleepMinutes == null ? 0 : s.sleepMinutes / r.sleepTargetMinutes, text: s.sleepMinutes == null ? "not logged" : prettyDuration(s.sleepMinutes), warn: false },
    {
      name: "Up on time",
      pct: !s.wakeAt ? 0 : st.wake === "hit" ? 1 : 0.6,
      text: s.wakeAt ? `${prettyTime(s.wakeAt, r.tz).toLowerCase().replace(" ", "")}, by ${prettyClock(wakeTarget(day, r)).toLowerCase().replace(" ", "")}` : "not logged",
      warn: st.wake === "near" || st.wake === "miss",
    },
  ];
  const R = [92, 76, 60, 44];
  const tone = (k: number) => `color-mix(in srgb, var(--series-1) ${100 - k * 22}%, var(--mixto))`;
  const arcs = items
    .map((it, k) => {
      const c = 2 * Math.PI * R[k];
      const len = c * Math.max(0, Math.min(1, it.pct));
      return `<circle cx="100" cy="100" r="${R[k]}" fill="none" stroke="var(--track)" stroke-width="13"/>${
        len > 0 ? `<circle cx="100" cy="100" r="${R[k]}" fill="none" stroke="${it.warn ? "var(--critical)" : tone(k)}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 100 100)"/>` : ""
      }`;
    })
    .join("");
  const legend = items
    .map((it, k) => `<div class="rl"><i style="background:${it.warn ? "var(--critical)" : tone(k)}"></i><div><div class="rk">${it.name}</div><div class="rv">${esc(it.text)}</div></div></div>`)
    .join("");
  const label = items.map((it) => `${it.name}: ${it.text}`).join(", ");
  return `<section class="card rings"><svg viewBox="0 0 200 200" role="img" aria-label="${esc(label)}">${arcs}</svg><div class="rlegend">${legend}</div></section>`;
}

/** Big numbers for the four goals, then the unscored macros on one line. */
function tiles(env: Env, p: Player, s: DayStats, day: string): string {
  const r = db.rules(env);
  const tile = (k: string, v: string, status: string) => `<div class="card tile2"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${status}</div></div>`;
  const out: string[] = [];
  const done = '<span class="ok">Done</span>';
  if (p.calorie_target != null && p.goal_type) {
    const cut = p.goal_type === "cut";
    const gap = Math.abs(p.calorie_target - s.calories);
    let st = "Nothing logged";
    if (s.unitemized) st = '<span class="bad">A total with no foods, not counted</span>';
    else if (s.foodCount > 0) {
      if (cut && s.calories > p.calorie_target) st = calorieGoalMet(p, s, r) ? `Within grace · ${fmt(gap)} over` : `<span class="bad">${fmt(gap)} over</span>`;
      else if (cut) st = `${fmt(gap)} left`;
      else st = calorieGoalMet(p, s, r) ? done : `${fmt(gap)} to go`;
    }
    out.push(tile(`Calories · ${cut ? "max" : "min"} ${fmt(p.calorie_target)}`, fmt(s.calories), st));
  }
  if (p.protein_target != null) {
    const st = s.unitemized ? '<span class="bad">Not counted</span>' : proteinGoalMet(p, s, r) ? done : `${Math.max(0, p.protein_target - s.protein)} g to go`;
    out.push(tile(`Protein · min ${p.protein_target} g`, `${s.protein}<small>g</small>`, st));
  }
  const sleep = s.sleepMinutes;
  out.push(
    tile(
      `Sleep · ${shortDur(r.sleepTargetMinutes)}+`,
      sleep != null ? hm(sleep) : "–",
      sleep == null ? "Not logged" : sleep >= r.sleepTargetMinutes ? done : `<span class="bad">${shortDur(r.sleepTargetMinutes - sleep)} short</span>`,
    ),
  );
  const target = wakeTarget(day, r);
  const late = s.wakeAt ? wakeMinutes(s.wakeAt, r.tz) - target : 0;
  out.push(
    tile(
      `Up by ${prettyClock(target).replace(/ (AM|PM)/, "")}`,
      s.wakeAt ? prettyTime(s.wakeAt, r.tz).replace(/ (AM|PM)/, (m) => `<small>${m.trim().toLowerCase()}</small>`) : "–",
      !s.wakeAt ? "Not logged" : wakeGoalMet(day, s, r) ? done : `<span class="bad">${late} min late</span>`,
    ),
  );
  const extras = [
    p.fat_target != null ? `Fat ${s.fat} / ${p.fat_target} g` : `Fat ${s.fat} g`,
    p.carb_target != null ? `Carbs ${s.carbs} / ~${p.carb_target} g` : `Carbs ${s.carbs} g`,
    ...(p.sugar_target != null ? [s.sugar == null ? `Added sugar – / ${p.sugar_target} g` : `Added sugar ${s.addedSugar ?? 0} / ${p.sugar_target} g`] : []),
  ];
  return `<section class="tiles2">${out.join("")}</section><p class="macros">${extras.map((x) => `<span>${x}</span>`).join("")}</p>`;
}

/** A row per goal, a square per day, and how many days it was hit. */
function weekGrid(w: WeekGoals, today: string): string {
  const heads = w.days.map((d) => `<span class="dh${d === today ? " now" : ""}" title="${prettyDay(d)}">${prettyDay(d).slice(0, 1)}</span>`).join("");
  const rows = GOAL_KEYS.map((k) => {
    const cells = w.days
      .map((d, i) => {
        const st = w.status[i]?.[k];
        if (!st) return `<span class="cell"><span class="sm s-future" aria-hidden="true"></span></span>`;
        return `<span class="cell">${mark(st, `${prettyDay(d)} · ${GOAL_NAMES[k]}: ${ST_WORDS[st]}`)}</span>`;
      })
      .join("");
    const c = w.counts[k];
    return `<span class="gn">${GOAL_NAMES[k]}</span>${cells}<span class="gc">${c.of ? `${c.hit}/${c.of}` : "–"}</span>`;
  }).join("");
  return `<div class="wgrid"><span></span>${heads}<span></span>${rows}</div>`;
}

function averagesCard(a: Averages): string {
  const cell = (k: string, v: string) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
  return `<section class="card"><h3>Last seven days</h3><div class="avgs">${[
    cell("Sleep", a.sleepMinutes == null ? "–" : prettyDuration(a.sleepMinutes)),
    cell("Up at", a.wakeMinutes == null ? "–" : prettyClock(a.wakeMinutes).replace(/ (AM|PM)/, "")),
    cell("Calories", a.calories == null ? "–" : fmt(a.calories)),
    cell("Protein", a.protein == null ? "–" : `${a.protein} g`),
  ].join("")}</div></section>`;
}

export async function homePage(env: Env, player: Player, meToken: string, now: Date): Promise<Response> {
  const today = gameDay(now, env.GAME_TZ);
  const start = weekStart(today);
  const [s, week, streaks, avgs, gym, todayMeals, yMeals] = await Promise.all([
    dayStats(env, player.id, today),
    weekGoals(env, player, start, today),
    goalStreaks(env, player, today),
    lastWeekAverages(env, player, today),
    gymSummary(env, player, today),
    db.mealsForDay(env.DB, player.id, today),
    db.mealsForDay(env.DB, player.id, addDays(today, -1)),
  ]);
  const r = db.rules(env);
  const notes = weekNotes(week, streaks, today);
  const sugar = player.sugar_target != null;
  const list = (ms: db.MealWithItems[], empty: string) =>
    ms.length ? ms.map((m) => mealBlock(m, sugar, env.GAME_TZ)).join("") : `<p class="muted" style="margin:0">${empty}</p>`;
  return layout(
    "Health",
    `${nav("today")}
    <section class="intro"><div class="eyebrow">${FULL_DATE(today)}</div><p class="prose big">${esc(todaySentence(env, player, s, today))}</p></section>
    ${rings(env, player, s, today, today)}
    ${tiles(env, player, s, today)}
    <section class="card tips"><div class="row"><h3>This week</h3><span class="muted small">${prettyDay(start).slice(4)} to ${prettyDay(addDays(start, 6)).slice(4)}</span></div>
      ${weekGrid(week, today)}${STATUS_KEY}<p class="tip-out" aria-live="polite"></p>
      ${notes ? `<p class="prose note">${esc(notes)}</p>` : ""}</section>
    ${averagesCard(avgs)}
    ${gymPanel(player, gym, meToken, today)}
    <h2>Today's food</h2><div class="card">${list(todayMeals, "Nothing logged yet today. Text Poke what you ate.")}</div>
    <h2>Yesterday</h2><div class="card">${list(yMeals, "Nothing logged yesterday.")}</div>
    ${sugarPanel(player, meToken)}
    <p class="rules">Goals: calories (${r.calorieGrace} cal of grace), protein (${r.proteinGrace} g of grace), ${shortDur(r.sleepTargetMinutes)}+ of sleep, and up by ${prettyClock(r.wakeWeekday)} on weekdays or ${prettyClock(r.wakeWeekend)} on weekends (${r.wakeGraceMinutes} min grace). Close means within 10% on food or 30 minutes on sleep and wake-up.</p>`,
    `${TIP_JS}<script>setTimeout(() => location.reload(), 5 * 60 * 1000)</script>`,
  );
}

// ---------- gym ----------

const KIND_LABEL = { gym: "Gym", sport: "Sport", run: "Run" } as const;

/**
 * GitHub-style grid: one column per Mon-Sun week, from the week tracking started through this week,
 * so it grows a column each week. 1 workout = lighter square, 2+ = full color.
 */
function gymRow(p: Player, g: GymSummary, from: string, today: string): string {
  const byDay = new Map<string, Workout[]>();
  for (const w of g.workouts) byDay.set(w.day, [...(byDay.get(w.day) ?? []), w]);
  const first = weekStart(from);
  const weeks = Math.round((Date.parse(weekStart(today)) - Date.parse(first)) / (7 * 864e5)) + 1;
  // Label a column with a month when that month's 1st falls in it; the first column gets one too
  // unless a label lands right next to it.
  const monthStart = (monday: string) => weekDays(monday).find((d) => d.endsWith("-01"));
  const cells: string[] = ["<span></span>", ...["Mon", "", "Wed", "", "Fri", "", "Sun"].map((d) => `<span class="dl">${d}</span>`)];
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(first, w * 7);
    let label = monthStart(monday);
    if (!label && w === 0 && ![1, 2].some((k) => k < weeks && monthStart(addDays(monday, k * 7)))) label = monday;
    cells.push(`<span class="ml">${label ? prettyDay(label).slice(4, 7) : ""}</span>`);
    for (const day of weekDays(monday)) {
      const list = byDay.get(day) ?? [];
      const what = list.map((x) => `${KIND_LABEL[x.kind]}${x.note ? ` (${x.note})` : ""}`).join(" + ");
      const text = list.length ? `${prettyDay(day)}: ${list.length > 1 ? `${list.length} workouts, ` : ""}${what}` : `${prettyDay(day)}: ${day < from ? "before tracking started" : "rest day"}`;
      const level = list.length >= 2 ? "on2" : list.length ? "on1" : "";
      const cls = ["c", day > today ? "future" : level, day === today ? "today" : ""].filter(Boolean).join(" ");
      cells.push(
        day > today
          ? `<span class="${cls}"></span>`
          : `<button type="button" class="${cls}" aria-label="${esc(text)}" title="${esc(text)}" data-tip="${esc(text)}"></button>`,
      );
    }
  }
  const parts = [
    `This week: ${g.thisWeek}${p.workout_target ? ` of ${p.workout_target}` : ""}`,
    ...(p.workout_target ? [] : ["no goal yet"]),
    ...(g.streak ? [`${g.streak}-week streak`] : []),
    `${g.total} total`,
  ];
  return `<div class="gym-row" style="--gc:${ACCENT}">
    <div class="gym-head"><h3>Workouts</h3>
      <span class="t">${parts.map((t) => `<span>${t}</span>`).join(" · ")}</span></div>
    <div class="gym-scroll"><div class="gym-grid">${cells.join("")}</div></div></div>`;
}

const GYM_KEY = `<p class="rules gym-key"><span><i></i> rest</span><span><i style="background:color-mix(in srgb, var(--ink-2) 45%, transparent)"></i> 1 workout</span><span><i style="background:var(--ink-2)"></i> 2+ in a day</span></p>`;

async function gymCard(env: Env, player: Player, today: string): Promise<string> {
  const from = (await trackingStart(env)) ?? today;
  return `<div class="card gym">${gymRow(player, await gymSummary(env, player, today), from, today)}
    <p class="gym-tip" aria-live="polite">Tap a square to see the day.</p>
    ${GYM_KEY}
    <p class="rules">Not scored, just consistency. Text your agent "hit the gym", "played tennis", or "went for a run". Set a weekly goal with "I want to work out 3 times a week"; your streak counts the weeks you hit it.</p></div>`;
}

// ---------- history ----------

export async function historyPage(env: Env, player: Player, now: Date, range: string | null): Promise<Response> {
  const today = gameDay(now, env.GAME_TZ);
  const start = await historyStart(env, player, today);
  const total = dayCount(start, today);
  // Everything since tracking started. A shorter range is offered only once there's enough history for it.
  const short = total > 35 && range === "4w";
  const from = short ? addDays(today, -27) : start;
  const days = daysFrom(from, today);

  const weeks: string[] = [];
  for (let w = weekStart(today); w >= weekStart(start); w = addDays(w, -7)) weeks.push(w);
  const [scored, stats, weights] = await Promise.all([
    Promise.all(weeks.map((w) => weekGoals(env, player, w, today))),
    db.statsForRange(env.DB, player.id, from, today),
    db.weightsForPlayer(env.DB, player.id),
  ]);
  const goalHeads = GOAL_KEYS.map((k) => `<th class="n">${GOAL_NAMES[k]}</th>`).join("");
  const weekRows = scored
    .map((w) => {
      const live = w.start === weekStart(today);
      const cells = GOAL_KEYS.map((k) => {
        const c = w.counts[k];
        return `<td class="n">${c.of ? `<strong>${c.hit}</strong><span class="muted">/${c.of}</span>` : '<span class="muted">–</span>'}</td>`;
      }).join("");
      return `<tr><td>${prettyDay(w.start).slice(4)}${live ? ' <span class="muted">· now</span>' : ""}</td>${cells}</tr>`;
    })
    .join("");

  const me: Series = { p: player, stat: (d) => stats.get(d) ?? EMPTY_DAY };
  const chips =
    total > 35
      ? `<div class="chips"><a href="/history" ${short ? "" : 'aria-current="true"'}>All</a><a href="/history?range=4w" ${short ? 'aria-current="true"' : ""}>Last 4 weeks</a></div>`
      : "";

  return layout(
    "History",
    `${nav("history")}
    <div class="date"><span>Since ${prettyDay(start)}</span><span>${total} day${total === 1 ? "" : "s"}</span></div>${chips}
    <h2>Weeks</h2>
    <div class="card table-wrap"><table class="wk"><thead><tr><th>Week of</th>${goalHeads}</tr></thead>
    <tbody>${weekRows}</tbody></table><p class="rules">Days each goal was hit, out of the days it was logged.</p></div>
    <h2>Goals hit</h2>${hitRates(env, me, days, today)}
    <h2>Day by day</h2>${dayByDay(env, me, days, today)}
    <h2>Trends</h2>${trends(env, me, days, today, weights)}
    <h2>Gym consistency</h2>${await gymCard(env, player, today)}`,
    TIP_JS,
  );
}

type Series = { p: Player; stat: (d: string) => DayStats };

async function historyStart(env: Env, player: Player, today: string): Promise<string> {
  const start = (await trackingStart(env)) ?? (await db.firstActivityDay(env.DB, player.id)) ?? today;
  return start > today ? today : start;
}
const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
const daysFrom = (from: string, to: string) => Array.from({ length: dayCount(from, to) }, (_, k) => addDays(from, k));

const ST_LABEL: Record<GoalStatus, string> = { hit: "hit", near: "close", miss: "missed", none: "nothing logged", now: "in progress" };

/** How often each goal was hit, out of the finished days it was logged. */
function hitRates(env: Env, { p, stat }: Series, days: string[], today: string): string {
  const r = db.rules(env);
  const done = days.filter((d) => d < today);
  if (!done.length) return `<div class="card muted">Hit rates show up after the first full day.</div>`;
  const statuses = done.map((d) => dayStatus(p, stat(d), r, d, today));
  const cells = GOAL_KEYS.map((k) => {
    const judged = statuses.filter((x) => x[k] !== "none");
    const hit = judged.filter((x) => x[k] === "hit").length;
    const pct = judged.length ? Math.round((hit / judged.length) * 100) : 0;
    return `<div class="rate"><div class="rk">${GOAL_NAMES[k]}</div><div class="rv">${judged.length ? `${pct}<small>%</small>` : "–"}</div>
      <div class="rbar"><span style="width:${pct}%;background:${ACCENT}"></span></div><div class="rk">${hit}/${judged.length} days</div></div>`;
  }).join("");
  return `<div class="card"><div class="rates">${cells}</div><p class="rules">Days with nothing logged don't count either way.</p></div>`;
}

/** What happened on a day, in words. */
function dayDetail(env: Env, p: Player, s: DayStats): string {
  const parts = [
    s.foodCount ? `${fmt(s.calories)} cal${s.unitemized ? " (includes a total with no foods, not counted)" : ""}` : "no food logged",
    ...(s.foodCount ? [`${s.protein}g protein`, `${s.fat}g fat`, `${s.carbs}g carbs`] : []),
    ...(p.sugar_target != null && s.sugar != null ? [`${s.sugar}g sugar (${s.addedSugar ?? 0}g added)`] : []),
    s.sleepMinutes != null ? `${prettyDuration(s.sleepMinutes)} sleep` : "no sleep logged",
    s.wakeAt ? `up ${prettyTime(s.wakeAt, env.GAME_TZ)}` : "no wake-up logged",
  ];
  return parts.join(" · ");
}

/** Newest day first, with a square per goal. Tap a day for the numbers. */
function dayByDay(env: Env, { p, stat }: Series, days: string[], today: string): string {
  const r = db.rules(env);
  const rows = [...days]
    .reverse()
    .map((d) => {
      const st = dayStatus(p, stat(d), r, d, today);
      const cells = GOAL_KEYS.map((k) => mark(st[k], `${GOAL_NAMES[k]}: ${ST_LABEL[st[k]]}`)).join("");
      return `<details class="drow"><summary><span class="dd">${d === today ? "Today" : prettyDay(d)}${d === today ? ' <small class="muted">so far</small>' : ""}</span><span class="dp">${cells}</span></summary><div class="ddet"><p>${dayDetail(env, p, stat(d))}</p></div></details>`;
    })
    .join("");
  return `<div class="card days one"><div class="dhead"><span></span><span class="dp">${GOAL_KEYS.map((k) => `<span class="dl" title="${GOAL_NAMES[k]}">${GOAL_NAMES[k].slice(0, 3)}</span>`).join("")}</span></div>${rows}
    ${STATUS_KEY}<p class="rules">Calories, protein, sleep, up on time. Tap a day for the numbers.</p></div>`;
}

// Wake-up dots plot (WAKE_SPAN - minutes after midnight), so 5am sits at the top and 1pm at the bottom.
const WAKE_SPAN = 24 * 60;

type Bar = { day: string; value: number | null; hit: boolean; tip: string };

/**
 * Daily bars: solid when the goal was hit, faded when missed, with the goal as a dashed line.
 * `target` can vary by day (the wake-up deadline is later on weekends).
 */
type GoalDir = { dir: "max" | "min" | "about" | "range"; label: string; lo?: number };

/**
 * Which side of the goal line is good: a faint band on that side, and the goal written on the line
 * ("≤ 1,700" for a max, "≥ 120g" for a min), so a max line can't be mistaken for a min.
 */
function goalMarks(W: number, H: number, yLine: number, goal: GoalDir | undefined, yLo?: number): { zone: string; label: string } {
  if (!goal) return { zone: "", label: "" };
  if (goal.dir === "range" && yLo != null) {
    // Cut calories: between the floor and the max, with the floor drawn as a second line.
    return {
      zone: `<rect x="0" y="${yLine}" width="${W}" height="${Math.max(0, yLo - yLine)}" class="zone"/><line x1="0" x2="${W}" y1="${yLo}" y2="${yLo}" class="goal"/>`,
      label: `<span class="glabel" style="top:${((yLine / H) * 100).toFixed(1)}%">${esc(goal.label)}</span>`,
    };
  }
  const zone =
    goal.dir === "max" ? `<rect x="0" y="${yLine}" width="${W}" height="${Math.max(0, H - yLine)}" class="zone"/>`
    : goal.dir === "min" ? `<rect x="0" y="0" width="${W}" height="${Math.max(0, yLine)}" class="zone"/>`
    : "";
  const sym = goal.dir === "max" ? "≤ " : goal.dir === "min" ? "≥ " : "~";
  return { zone, label: `<span class="glabel" style="top:${((yLine / H) * 100).toFixed(1)}%">${sym}${esc(goal.label)}</span>` };
}

function barChart(bars: Bar[], color: string, target: (day: string) => number | null, opts: { dots?: boolean; h?: number; goal?: GoalDir } = {}): string {
  const W = 300, H = opts.h ?? 150, top = 8;
  const vals = bars.flatMap((b) => [b.value, target(b.day)]).filter((v): v is number => v != null);
  // Bars start at zero; dots zoom in on the range they use.
  const min = opts.dots ? Math.min(...vals) - 40 : 0;
  const max = opts.dots ? Math.max(...vals) + 40 : Math.max(...vals, 1) * 1.08;
  const y = (v: number) => top + (H - top - 6) * (1 - (Math.min(Math.max(v, min), max) - min) / (max - min));
  const step = W / bars.length;
  const bw = Math.max(2, Math.min(28, step * 0.62));
  const marks = bars
    .map((b, k) => {
      const cx = step * k + step / 2;
      const t = target(b.day);
      const goal = t != null ? `<line x1="${cx - step / 2}" x2="${cx + step / 2}" y1="${y(t)}" y2="${y(t)}" class="goal"/>` : "";
      const bar =
        b.value == null
          ? `<circle cx="${cx}" cy="${H - 2}" r="1.5" fill="var(--axis)"/>`
          : opts.dots
          ? `<circle cx="${cx}" cy="${y(b.value)}" r="6" fill="${color}" opacity="${b.hit ? 1 : 0.32}"/>`
          : `<rect x="${cx - bw / 2}" y="${Math.min(y(b.value), H - 2)}" width="${bw}" height="${Math.max(2, H - y(b.value))}" rx="${Math.min(4, bw / 2)}" fill="${color}" opacity="${b.hit ? 1 : 0.32}"/>`;
      return `<g data-tip="${esc(b.tip)}">${goal}${bar}<rect x="${cx - step / 2}" y="0" width="${step}" height="${H}" fill="transparent"><title>${esc(b.tip)}</title></rect></g>`;
    })
    .join("");
  // The band and label only make sense when the goal is the same every day (not the wake-up deadline).
  const targets = new Set(bars.map((b) => target(b.day)));
  const t = targets.size === 1 ? [...targets][0] : null;
  const g = t != null ? goalMarks(W, H, y(t), opts.goal, opts.goal?.lo != null ? y(opts.goal.lo) : undefined) : { zone: "", label: "" };
  return `<div class="cbox"><svg viewBox="0 0 ${W} ${H}" class="bars" role="img">${g.zone}${marks}</svg>${g.label}</div>`;
}

/** Sugar per day: added (solid) stacked under natural (faded), with the added-sugar limit dashed. */
function sugarCard(x: Series, days: string[], today: string, axis: string, H: number): string {
  const W = 300, top = 8;
  const limit = x.p.sugar_target!;
  const known = days.map((d) => x.stat(d)).filter((s) => s.sugar != null);
  const max = Math.max(limit, ...known.map((s) => s.sugar!), 1) * 1.08;
  const y = (v: number) => top + (H - top) * (1 - v / max);
  const step = W / days.length;
  const bw = Math.max(2, Math.min(28, step * 0.62));
  const color = ACCENT;
  const marks = days
    .map((d, k) => {
      const s = x.stat(d);
      const cx = step * k + step / 2;
      if (s.sugar == null) return `<circle cx="${cx}" cy="${H - 2}" r="1.5" fill="var(--axis)"/>`;
      const added = s.addedSugar ?? 0;
      const tip = `${prettyDay(d)}: ${s.sugar}g sugar, ${added}g added${added > limit ? " (over)" : ""}, ${s.sugar - added}g natural${d === today ? " (so far)" : ""}`;
      const r = Math.min(4, bw / 2);
      return `<g data-tip="${esc(tip)}">
        <rect x="${cx - bw / 2}" y="${y(s.sugar)}" width="${bw}" height="${Math.max(0, H - y(s.sugar))}" rx="${r}" fill="${color}" opacity="0.3"/>
        ${added ? `<rect x="${cx - bw / 2}" y="${y(added)}" width="${bw}" height="${Math.max(2, H - y(added))}" rx="${r}" fill="${color}"/>` : ""}
        <rect x="${cx - step / 2}" y="0" width="${step}" height="${H}" fill="transparent"><title>${esc(tip)}</title></rect></g>`;
    })
    .join("");
  const g = goalMarks(W, H, y(limit), { dir: "max", label: `${limit}g added` });
  const svg = `<div class="cbox"><svg viewBox="0 0 ${W} ${H}" class="bars" role="img">${g.zone}<line x1="0" x2="${W}" y1="${y(limit)}" y2="${y(limit)}" class="goal"/>${marks}</svg>${g.label}</div>`;
  return `<div class="card tcard tips"><h3>Sugar</h3><div class="tcols n1"><div class="tcol" style="--gc:${color}">
    <div class="tlabel"><span class="muted">solid = added, max ${limit}g · faded = natural</span></div>${svg}${axis}</div></div><p class="tip-out" aria-live="polite"></p></div>`;
}

/** Weight over time as a line, with the goal dashed. */
function lineChart(points: { day: string; value: number | null }[], color: string, goal: number | null): string {
  const W = 300, H = 90, pad = 8;
  const known = points.filter((x) => x.value != null) as { day: string; value: number }[];
  if (!known.length) return `<p class="muted empty-chart">No weigh-ins yet. Text Poke your weight.</p>`;
  const vals = [...known.map((x) => x.value), ...(goal != null ? [goal] : [])];
  const lo = Math.min(...vals) - 1, hi = Math.max(...vals) + 1;
  const x = (k: number) => pad + ((W - 2 * pad) * k) / Math.max(1, points.length - 1);
  const y = (v: number) => pad + (H - 2 * pad) * (1 - (v - lo) / (hi - lo));
  const idx = (d: string) => points.findIndex((p) => p.day === d);
  const path = known.map((k, n) => `${n ? "L" : "M"}${x(idx(k.day)).toFixed(1)},${y(k.value).toFixed(1)}`).join("");
  const dots = known
    .map((k) => `<g data-tip="${prettyDay(k.day)}: ${k.value} lb"><circle cx="${x(idx(k.day))}" cy="${y(k.value)}" r="3.5" fill="${color}"/><circle cx="${x(idx(k.day))}" cy="${y(k.value)}" r="12" fill="transparent"><title>${prettyDay(k.day)}: ${k.value} lb</title></circle></g>`)
    .join("");
  const g = goal != null ? `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="bars" role="img">${g}<path d="${path}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>${dots}</svg>`;
}

/** One card per goal, with daily bars against the goal line. */
function trends(env: Env, x: Series, days: string[], today: string, weights: { day: string; lb: number }[] = []): string {
  const r = db.rules(env);
  const axis = `<div class="xaxis"><span>${prettyDay(days[0]).slice(4)}</span><span>${days.length > 1 ? prettyDay(days.at(-1)!).slice(4) : ""}</span></div>`;
  const clock = (min: number) => prettyClock(Math.round(min)).toLowerCase().replace(" ", "");
  type Metric = { title: string; goal: (p: Player) => string; chart: (s: Series) => string; same?: boolean };
  const h = 90;
  const bars = ({ p, stat }: Series, value: (s: DayStats) => number | null, hit: (s: DayStats, d: string) => boolean, tip: (s: DayStats, v: number) => string) =>
    days.map((d) => {
      const s = stat(d);
      const v = value(s);
      return { day: d, value: v, hit: v != null && hit(s, d), tip: `${prettyDay(d)}: ${v == null ? "not logged" : tip(s, v)}${d === today ? " (so far)" : ""}` };
    });
  const food = (s: DayStats, v: number) => (s.foodCount ? v : null);
  const metrics: Metric[] = [
    {
      title: "Calories",
      goal: (p) => (p.calorie_target == null ? "no goal" : p.goal_type === "cut" ? `stay between ${fmt(r.cutFloorCalories)} and ${fmt(p.calorie_target)}` : `reach ${fmt(p.calorie_target)}`),
      chart: (x) => barChart(bars(x, (s) => food(s, s.calories), (s, d) => scoreDay(x.p, s, r, d).calOk, (_, v) => `${fmt(v)} cal`), ACCENT, () => x.p.calorie_target, {
            h,
            goal:
              x.p.calorie_target == null ? undefined
              : x.p.goal_type === "cut" ? { dir: "range", lo: r.cutFloorCalories, label: `${fmt(r.cutFloorCalories)}–${fmt(x.p.calorie_target)}` }
              : { dir: "min", label: fmt(x.p.calorie_target) },
          }),
    },
    {
      title: "Protein",
      goal: (p) => (p.protein_target == null ? "no goal" : `reach ${p.protein_target}g`),
      chart: (x) => barChart(bars(x, (s) => food(s, s.protein), (s) => proteinGoalMet(x.p, s, r), (_, v) => `${v}g protein`), ACCENT, () => x.p.protein_target, { h, goal: { dir: "min", label: `${x.p.protein_target}g` } }),
    },
    {
            title: "Fat",
            goal: (p: Player) => (p.fat_target == null ? "not scored" : `reach ${p.fat_target}g · not scored`),
            chart: (x: Series) => barChart(bars(x, (s) => food(s, s.fat), (s) => x.p.fat_target == null || s.fat >= x.p.fat_target, (_, v) => `${v}g fat`), ACCENT, () => x.p.fat_target, { h, goal: { dir: "min", label: `${x.p.fat_target}g` } }),
          },
    {
            title: "Carbs",
            goal: (p: Player) => (p.carb_target == null ? "not scored" : `about ${p.carb_target}g · not scored`),
            chart: (x: Series) =>
              barChart(bars(x, (s) => food(s, s.carbs), (s) => x.p.carb_target == null || Math.abs(s.carbs - x.p.carb_target) <= x.p.carb_target * 0.15, (_, v) => `${v}g carbs`), ACCENT, () => x.p.carb_target, { h, goal: { dir: "about", label: `${x.p.carb_target}g` } }),
    },
    {
      title: "Sleep",
      same: true,
      goal: () => `${prettyDuration(r.sleepTargetMinutes).replace(" 00m", "")}+`,
      chart: (x) => barChart(bars(x, (s) => (s.sleepMinutes == null ? null : s.sleepMinutes / 60), (s) => (s.sleepMinutes ?? 0) >= r.sleepTargetMinutes, (s) => prettyDuration(s.sleepMinutes!)), ACCENT, () => r.sleepTargetMinutes / 60, { h, goal: { dir: "min", label: prettyDuration(r.sleepTargetMinutes).replace(" 00m", "") } }),
    },
    {
      title: "Wake-up",
      same: true,
      goal: () => `by ${clock(r.wakeWeekday)}, weekends ${clock(r.wakeWeekend)}`,
      // Earlier is higher, so a dot above the line is on time.
      chart: (x) =>
        barChart(
          bars(x, (s) => (s.wakeAt ? WAKE_SPAN - wakeMinutes(s.wakeAt, r.tz) : null), (s, d) => wakeGoalMet(d, s, r), (s) => `up ${clock(wakeMinutes(s.wakeAt!, r.tz))}`),
          ACCENT,
          (d) => WAKE_SPAN - wakeTarget(d, r),
          { dots: true, h },
        ),
    },
  ];
  const cards = metrics
    .map((m) => {
      const goal = m.same ? "" : `<div class="tlabel"><span class="muted">${esc(m.goal(x.p))}</span></div>`;
      return `<div class="card tcard tips"><h3>${m.title}${m.same ? ` <span class="muted">· ${esc(m.goal(x.p))}</span>` : ""}</h3><div class="tcols n1"><div class="tcol" style="--gc:${ACCENT}">${goal}${m.chart(x)}${axis}</div></div><p class="tip-out" aria-live="polite"></p></div>`;
    })
    .join("");
  const sugar = x.p.sugar_target != null ? sugarCard(x, days, today, axis, h) : "";
  const weight = `<div class="card tcard tips"><h3>Weight</h3><div class="tcols n1"><div class="tcol"><div class="tlabel"><span class="muted">${x.p.goal_weight_lb != null ? `goal ${x.p.goal_weight_lb} lb` : "no goal weight"}</span></div>
    ${lineChart(days.map((d) => ({ day: d, value: weights.find((w) => w.day === d)?.lb ?? null })), ACCENT, x.p.goal_weight_lb)}${axis}</div></div><p class="tip-out" aria-live="polite"></p></div>`;
  return `<div class="tgrid">${cards}${sugar}${weight}</div><p class="rules">Solid means the goal was hit, faded means missed. The dashed line is the goal, and the shaded side is where you want to be (≤ stay under, ≥ reach, a range means stay between the two lines). On wake-up, higher is earlier. Tap a bar or dot for the number.</p>`;
}

/** Tap or hover anything with data-tip to show it in the nearest .tip-out line. */
const TIP_JS = `<script>
document.querySelectorAll(".gym-scroll").forEach((el) => (el.scrollLeft = el.scrollWidth));
document.querySelectorAll(".tips, .gym").forEach((card) => {
  const out = card.querySelector(".tip-out, .gym-tip");
  if (!out) return;
  const show = (e) => { const c = e.target.closest("[data-tip]"); if (c && card.contains(c)) out.textContent = c.dataset.tip; };
  card.addEventListener("pointerover", show);
  card.addEventListener("focusin", show);
  card.addEventListener("click", show);
});
</script>`;

// ---------- controls on the page (work without the agent) ----------

/** This week's workouts as a strip, a line about them, and one-tap logging (so Poke doesn't need the workout tools). */
function gymPanel(p: Player, g: GymSummary, meToken: string, today: string): string {
  const action = `/me/${esc(meToken)}/workout`;
  const start = weekStart(today);
  const yesterday = addDays(today, -1);
  const strip = weekDays(start)
    .map((d) => {
      const n = g.workouts.filter((w) => w.day === d).length;
      const tip = `${prettyDay(d)}: ${n ? `${n} workout${n > 1 ? "s" : ""}` : d > today ? "coming up" : "rest"}`;
      return `<div class="wday"><span class="wbar${n >= 2 ? " on2" : n ? " on1" : ""}${d > today ? " future" : ""}" role="img" aria-label="${esc(tip)}" title="${esc(tip)}"></span><span class="dh${d === today ? " now" : ""}">${prettyDay(d).slice(0, 1)}</span></div>`;
    })
    .join("");
  const recent = g.workouts.filter((w) => w.day === today || w.day === yesterday).reverse();
  const list = recent.length
    ? `<ul class="wlist">${recent
        .map(
          (w) => `<li>${w.day === today ? "Today" : "Yesterday"} · ${KIND_LABEL[w.kind]}${w.note ? ` (${esc(w.note)})` : ""}
          <form method="post" action="${action}"><input type="hidden" name="remove" value="${w.id}"><button class="pill" type="submit" aria-label="Remove">Undo</button></form></li>`,
        )
        .join("")}</ul>`
    : "";
  const goal = Array.from({ length: 7 }, (_, k) => `<option value="${k + 1}"${p.workout_target === k + 1 ? " selected" : ""}>${k + 1}</option>`).join("");
  return `<section class="card gym-log" id="gym"><div class="row"><h3>Workouts</h3><span class="small"><b>${g.thisWeek}</b><span class="muted">${p.workout_target ? ` / ${p.workout_target}` : ""} this week</span></span></div>
    <div class="wstrip">${strip}</div>
    <p class="prose note">${esc(gymSentence(p, g, start))}</p>
    <form method="post" action="${action}">
      <div class="seg" role="radiogroup" aria-label="Day"><label><input type="radio" name="day" value="today" checked> Today</label><label><input type="radio" name="day" value="yesterday"> Yesterday</label></div>
      <div class="kinds"><button class="pill" name="kind" value="gym">Gym</button><button class="pill" name="kind" value="sport">Sport</button><button class="pill" name="kind" value="run">Run</button></div>
    </form>${list}
    <form method="post" action="/me/${esc(meToken)}/settings" class="inline">
      <span class="muted">Weekly goal</span>
      <select name="workout_target" aria-label="Weekly goal">${p.workout_target ? "" : '<option value="" selected>–</option>'}${goal}</select><button class="pill" type="submit">Save</button>
    </form></section>`;
}

/** Turn sugar tracking on or off and set the added-sugar limit. */
function sugarPanel(p: Player, meToken: string): string {
  const action = `/me/${esc(meToken)}/settings`;
  const limit = (v: number) => `<input type="number" name="sugar_target" min="1" max="200" value="${v}" inputmode="numeric" aria-label="Added sugar limit in grams">`;
  if (p.sugar_target != null) {
    return `<h2 id="sugar">Sugar</h2><div class="card"><form method="post" action="${action}" class="inline">
      <span class="muted">Added sugar limit</span>${limit(p.sugar_target)}<span class="muted">g a day</span><button class="pill" type="submit">Save</button>
      <button class="pill" type="submit" name="sugar" value="off">Stop tracking</button></form>
      <p class="rules">Not scored. 25g is the American Heart Association's limit for women, 36g for men.</p></div>`;
  }
  return `<h2 id="sugar">Sugar</h2><div class="card">
    <p style="margin:0 0 10px">Track added (refined) vs natural sugar against a daily limit. It isn't scored.</p>
    <form method="post" action="${action}" class="inline"><span class="muted">Added sugar limit</span>${limit(25)}<span class="muted">g</span><button class="pill" type="submit">Turn on</button></form>
    <p class="rules">25g is the American Heart Association's limit for women, 36g for men.</p></div>`;
}

// ---------- password (once per phone) ----------

export function lockedPage(next: string, error = ""): Response {
  return layout(
    "Health",
    `<header class="onboard">${MARK}<h1 class="title wordmark">Health</h1>
      <p class="lede">Food, sleep, and wake-up.<br>Four goals a day.</p></header>
    <form method="post" action="/unlock" class="card form">
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
      <input type="hidden" name="next" value="${esc(next)}">
      <label for="code">Password</label>
      <input id="code" name="code" type="password" required autocomplete="current-password" placeholder="Same as the join code">
      <button type="submit" class="wide">Open</button>
    </form>
    <p class="foot">This phone will remember it. Or open the link Poke gives you for "what's my page?"</p>`,
    "",
    "narrow",
  );
}
