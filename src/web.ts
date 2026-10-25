// Server-rendered pages: setup, today, history. No framework; charts are drawn by a
// small inline script from JSON embedded in the page.
import * as db from "./db";
import type { Env, Player } from "./db";
import { dayStats, gymSummary, mealTotals, trackingStart, weekPoints, type GymSummary } from "./game";
import { EMPTY_DAY, calorieGoalMet, proteinGoalMet, scoreDay, wakeGoalMet, wakeMinutes, wakeTarget, type DayStats } from "./scoring";
import type { Workout } from "./gym";
import { addDays, gameDay, prettyClock, prettyDay, prettyDuration, prettyTime, weekDays, weekStart } from "./time";

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

// The accent color, validated against each theme surface.
const ACCENT = "var(--series-1)";

const CSS = `
/* Three themes: warm white (the default), black, ocean. A phone's pick is saved in localStorage
   and set as data-theme before paint.
   The accent color is validated per theme; status never uses the accent (hits are a check in ink,
   misses are amber). */
:root {
  color-scheme: light;
  --sans: "Rubik", system-ui, -apple-system, "Segoe UI", sans-serif;
  --script: "Yellowtail", "Brush Script MT", cursive;
  --page: #f6f0e7;
  --page-grad: none;
  --surface: rgba(255, 251, 245, 0.58);
  --solid: #fffaf3;
  --raise: rgba(244, 236, 225, 0.55);
  --ink: #4a3f37;
  --ink-2: #6e6258;
  --muted: #8b7f73;
  --grid: #eee5d8;
  --axis: #ddd1c1;
  --ring: rgba(120, 100, 80, 0.10);
  --series-1: #d17aa0;
  --good: #4a3f37;
  --critical: #a85d00;
  --ascii: rgba(74,63,55,0.20);
  --ascii-hi: rgba(209,122,160,0.9);
  --aura-1: rgba(209,122,160,0.16);
  --aura-2: rgba(75,143,93,0.12);
  --blur: blur(16px) saturate(1.15);
}
:root[data-theme="warm"] {
  color-scheme: light;
  --page: #f6f0e7;
  --page-grad: none;
  --surface: rgba(255, 251, 245, 0.58);
  --solid: #fffaf3;
  --raise: rgba(244, 236, 225, 0.55);
  --ink: #4a3f37;
  --ink-2: #6e6258;
  --muted: #8b7f73;
  --grid: #eee5d8;
  --axis: #ddd1c1;
  --ring: rgba(120, 100, 80, 0.10);
  --series-1: #d17aa0;
  --good: #4a3f37;
  --critical: #a85d00;
  --ascii: rgba(74,63,55,0.20);
  --ascii-hi: rgba(209,122,160,0.9);
  --aura-1: rgba(209,122,160,0.16);
  --aura-2: rgba(75,143,93,0.12);
  --blur: blur(16px) saturate(1.15);
}
:root[data-theme="black"] {
  color-scheme: dark;
  --page: #050505;
  --page-grad: none;
  --surface: rgba(20, 21, 21, 0.58);
  --solid: #111212;
  --raise: rgba(255, 255, 255, 0.05);
  --ink: #f5f5f2;
  --ink-2: #b9bab5;
  --muted: #8b8c88;
  --grid: #1f2021;
  --axis: #2c2d2e;
  --ring: rgba(255, 255, 255, 0.08);
  --series-1: #f0a6c6;
  --good: #f5f5f2;
  --critical: #f0a33a;
  --ascii: rgba(255,255,255,0.13);
  --ascii-hi: rgba(240,166,198,0.9);
  --aura-1: rgba(240,166,198,0.10);
  --aura-2: rgba(79,154,106,0.10);
  --blur: blur(16px) saturate(1.15);
}
:root[data-theme="ocean"] {
  color-scheme: dark;
  --page: #0b3554;
  --page-grad: linear-gradient(170deg, #061626 0%, #0a3150 42%, #0e5470 72%, #1a7d89 100%);
  --surface: rgba(8, 26, 44, 0.58);
  --solid: #0d2b44;
  --raise: rgba(255, 255, 255, 0.07);
  --ink: #eef6fb;
  --ink-2: #bcd6e5;
  --muted: #8fb0c4;
  --grid: rgba(255, 255, 255, 0.08);
  --axis: rgba(255, 255, 255, 0.18);
  --ring: rgba(255, 255, 255, 0.10);
  --series-1: #f6b0cd;
  --good: #eef6fb;
  --critical: #ffc069;
  --ascii: rgba(205,236,246,0.16);
  --ascii-hi: rgba(170,236,246,0.95);
  --aura-1: rgba(246,176,205,0.10);
  --aura-2: rgba(126,220,230,0.12);
  --blur: blur(14px) saturate(1.2);
}
* { box-sizing: border-box; }
html { background: var(--page); min-height: 100%; }
/* The color lives on html only: a body background would paint over the fixed background layers. */
body { min-height: 100vh; min-height: 100dvh; margin: 0; background: transparent; color: var(--ink); font: 15px/1.45 var(--sans); }
/* Background: soft pink/green glows (and the ocean fade), a glow that follows the pointer, and an
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
.wordmark { font: 400 30px/1 var(--script); margin: 0; letter-spacing: 0; color: var(--ink); }
.themes { display: inline-flex; gap: 6px; padding: 5px; border-radius: 999px; background: var(--surface); }
.themes button { width: 20px; height: 20px; margin: 0; padding: 0; border-radius: 50%; cursor: pointer; border: 1px solid var(--axis); }
.themes button[data-t="warm"] { background: #f6f0e7; }
.themes button[data-t="black"] { background: #050505; }
.themes button[data-t="ocean"] { background: linear-gradient(160deg, #061626, #0e5470 60%, #1a7d89); }
.themes button[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--ink); }
.themes button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.topbar { margin: 0 0 18px; }
.onboard .title.wordmark { font: 400 48px/1.1 var(--script); }
main { max-width: 760px; margin: 0 auto; padding-block: 18px 56px; padding-inline: 16px; }
a { color: inherit; }
h1 { font: 700 19px/1.1 var(--sans); margin: 0; }
h2 { font: 600 16px/1.2 var(--sans); color: var(--ink-2); margin: 26px 4px 10px; }
h3 { font: 700 15px/1.2 var(--sans); margin: 0; }
.big, .v { font-weight: 700; font-variant-numeric: tabular-nums; }
nav { display: flex; gap: 12px; align-items: center; justify-content: space-between; flex-wrap: wrap; margin-bottom: 18px; }
nav h1 { font: 400 30px/1 var(--script); }
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
`;

const THEMES = `<div class="themes" role="group" aria-label="Theme">
  <button type="button" data-t="warm" aria-label="Warm white theme"></button>
  <button type="button" data-t="black" aria-label="Black theme"></button>
  <button type="button" data-t="ocean" aria-label="Ocean theme"></button></div>`;

const THEME_COLORS = { warm: "#f6f0e7", black: "#050505", ocean: "#0b3554" };

// Runs before paint so the saved theme never flashes the default.
const THEME_BOOT = `<script>try{var t=localStorage.getItem("hb-theme"),c=${JSON.stringify(THEME_COLORS)};if(t&&c[t]){document.documentElement.dataset.theme=t;document.querySelector('meta[name="theme-color"]').content=c[t]}}catch(e){}</script>`;

const THEME_JS = `<script>
(() => {
  const colors = ${JSON.stringify(THEME_COLORS)};
  const current = () => document.documentElement.dataset.theme || "warm";
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
<meta name="robots" content="noindex"><title>${esc(title === "Health Tracker" ? title : `${title} · Health Tracker`)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="alternate icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<meta name="apple-mobile-web-app-title" content="Health"><meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#f6f0e7">${THEME_BOOT}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Rubik:wght@400..800&family=Yellowtail&display=swap">
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

function mealBlock(m: db.MealWithItems, sugar: boolean): string {
  const t = mealTotals(m);
  const item = (it: db.FoodEntry) =>
    `<li>${esc(it.description)} <span class="muted">(${it.calories} cal, ${it.protein_g}g P, ${it.fat_g}g F, ${it.carbs_g}g C${sugar && it.sugar_g != null ? `, ${it.sugar_g}g sugar${it.added_sugar_g ? ` (${it.added_sugar_g}g added)` : ""}` : ""})</span></li>`;
  return `<div class="meal"><div class="meal-head"><div>${m.name ? esc(m.name) : "Meal"}</div></div>
    <div class="tot">${fmt(t.calories)} cal · ${t.protein}g protein · ${t.fat}g fat · ${t.carbs}g carbs</div>
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
      <p class="lede">Food, sleep, and wake-up.<br>Four points a day.</p></header>
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

function stat(k: string, v: string, status: string): string {
  return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${status}</div></div>`;
}

function playerCard(env: Env, p: Player, s: DayStats, day: string, todayPts: number): string {
  const r = db.rules(env);
  const tiles: string[] = [];
  if (p.calorie_target != null && p.goal_type) {
    const ok = calorieGoalMet(p, s, r);
    const cut = p.goal_type === "cut";
    const gap = Math.abs(p.calorie_target - s.calories);
    let st = '<span class="muted">Nothing logged</span>';
    if (s.foodCount > 0) {
      if (cut && s.calories > p.calorie_target) st = ok ? `<span class="ok">Within grace</span> · ${fmt(gap)} over` : `<span class="bad">${fmt(gap)} over</span>`;
      else if (cut) st = ok ? `<span class="ok">On target</span> · ${fmt(gap)} left` : `${fmt(gap)} left`;
      else st = ok ? `<span class="ok">Hit</span>` : `${fmt(gap)} to go`;
      if (s.unitemized) st = `<span class="bad">Total with no foods · not counted</span>`;
    }
    tiles.push(stat(`Calories · ${cut ? "max" : "min"} ${fmt(p.calorie_target)}`, fmt(s.calories), st));
  }
  if (p.protein_target != null) {
    const ok = proteinGoalMet(p, s, r);
    tiles.push(stat(`Protein · min ${p.protein_target}g`, `${s.protein}<small>g</small>`, s.unitemized ? '<span class="bad">Not counted</span>' : ok ? '<span class="ok">Hit</span>' : `${Math.max(0, p.protein_target - s.protein)}g to go`));
  }
  {
    const fatSt = p.fat_target == null ? "Not scored" : s.fat >= p.fat_target ? '<span class="ok">Hit</span> · not scored' : `${p.fat_target - s.fat}g low · not scored`;
    tiles.push(stat(p.fat_target != null ? `Fat · min ${p.fat_target}g` : "Fat", `${s.fat}<small>g</small>`, fatSt));
    const carbSt = p.carb_target == null ? "Not scored" : s.carbs >= p.carb_target ? '<span class="ok">Hit</span> · not scored' : `${p.carb_target - s.carbs}g to go · not scored`;
    tiles.push(stat(p.carb_target != null ? `Carbs · about ${p.carb_target}g` : "Carbs", `${s.carbs}<small>g</small>`, carbSt));
  }
  const sugarTile =
    p.sugar_target != null
      ? (() => {
          const added = s.addedSugar ?? 0;
          const st = s.sugar == null ? "No estimates yet" : `${added > p.sugar_target ? `<span class="bad">${added - p.sugar_target}g over</span>` : `${p.sugar_target - added}g of added left`} · ${s.sugar - added}g natural · not scored`;
          return `<div class="stat wide"><div class="k">Sugar · added max ${p.sugar_target}g</div><div class="v">${s.sugar == null ? "–" : `${added}<small>g added</small> <span class="of">${s.sugar}<small>g total</small></span>`}</div><div class="s">${st}</div></div>`;
        })()
      : "";
  const sleep = s.sleepMinutes;
  tiles.push(
    stat(
      `Sleep · ${prettyDuration(r.sleepTargetMinutes).replace(" 00m", "")} goal`,
      sleep != null ? hm(sleep) : "–",
      sleep == null ? "Not logged" : sleep >= r.sleepTargetMinutes ? '<span class="ok">Hit</span>' : `<span class="bad">${prettyDuration(r.sleepTargetMinutes - sleep).replace(" 00m", "")} short</span>`,
    ),
  );
  const target = wakeTarget(day, r);
  const late = s.wakeAt ? wakeMinutes(s.wakeAt, r.tz) - target : 0;
  tiles.push(
    stat(
      `Up by ${prettyClock(target).replace(" AM", "").replace(" PM", "")}`,
      s.wakeAt ? prettyTime(s.wakeAt, env.GAME_TZ).replace(/ (AM|PM)/, (m) => `<small>${m.toLowerCase()}</small>`) : "–",
      !s.wakeAt ? "Not logged" : wakeGoalMet(day, s, r) ? '<span class="ok">On time</span>' : `<span class="bad">${late} min late</span>`,
    ),
  );
  return `<div class="pcard"><div class="head"><h3>Today <span class="muted" style="font-weight:500">· ${p.goal_type ?? "no goal yet"}</span></h3><span class="t">${todayPts}/4</span></div>
    <div class="stats">${tiles.join("")}${sugarTile}</div></div>`;
}

/** Watch-face ring: the arc is today's points out of 4, the number is the week total. */
function face(weekPts: number, todayPts: number): string {
  const C = 2 * Math.PI * 50;
  const arc = (Math.min(todayPts, 4) / 4) * C;
  return `<div class="face"><svg viewBox="0 0 120 120" role="img" aria-label="${weekPts} points this week, ${todayPts} of 4 today">
      <circle cx="60" cy="60" r="50" fill="none" stroke="var(--raise)" stroke-width="10"/>
      ${arc > 0 ? `<circle cx="60" cy="60" r="50" fill="none" stroke="${ACCENT}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${arc.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 60 60)"/>` : ""}
      <text x="60" y="71" text-anchor="middle" fill="var(--ink)" font-family="Rubik, sans-serif" font-weight="700" font-size="34">${weekPts}</text>
    </svg><div class="n">This week</div><div class="d">${todayPts}/4 today</div></div>`;
}

/** The week so far: a bar per day, its height the day's points out of 4. */
function weekFace(w: Awaited<ReturnType<typeof weekPoints>>, today: string): string {
  const cols = w.days
    .map((d, k) => {
      const v = w.perDay[k];
      const tip = `${prettyDay(d)}: ${v == null ? (d > today ? "coming up" : "not counted") : `${v} of 4${d === today ? " so far" : ""}`}`;
      return `<div class="wd${d === today ? " now" : ""}" title="${esc(tip)}" aria-label="${esc(tip)}"><div class="wb"><span style="height:${((v ?? 0) / 4) * 100}%"></span></div><b>${v ?? "·"}</b><small>${prettyDay(d).slice(0, 2)}</small></div>`;
    })
    .join("");
  return `<div class="face week7"><div class="wds">${cols}</div><div class="n">${w.points}<span class="muted"> / 28</span></div><div class="d">out of 4 a day</div></div>`;
}

export async function homePage(env: Env, player: Player, meToken: string, now: Date): Promise<Response> {
  const today = gameDay(now, env.GAME_TZ);
  const start = weekStart(today);
  const r = db.rules(env);
  const [s, week, todayMeals, yMeals] = await Promise.all([
    dayStats(env, player.id, today),
    weekPoints(env, player, start, today),
    db.mealsForDay(env.DB, player.id, today),
    db.mealsForDay(env.DB, player.id, addDays(today, -1)),
  ]);
  const todayPts = scoreDay(player, s, r, today).points;
  const sugar = player.sugar_target != null;
  const list = (ms: db.MealWithItems[], empty: string) =>
    ms.length ? ms.map((m) => mealBlock(m, sugar)).join("") : `<p class="muted" style="margin:0">${empty}</p>`;
  return layout(
    "Health Tracker",
    `${nav("today")}
    <div class="date"><span>${prettyDay(today)}</span><span>Week of ${prettyDay(start).slice(4)}</span></div>
    <div class="faces">${face(week.points, todayPts)}${weekFace(week, today)}</div>
    <div class="players" style="margin-top:10px">${playerCard(env, player, s, today, todayPts)}</div>
    <p class="rules">1 point each for calories, protein, ${prettyDuration(r.sleepTargetMinutes)}+ sleep, and being up by ${prettyClock(r.wakeWeekday)} (weekends ${prettyClock(r.wakeWeekend)}, ${r.wakeGraceMinutes} min grace). Calories get ${r.calorieGrace} cal of grace and protein ${r.proteinGrace}g.</p>
    ${await gymPanel(env, player, meToken, today)}
    <h2>Today's food</h2><div class="card">${list(todayMeals, "Nothing logged yet today. Text Poke what you ate.")}</div>
    <h2>Yesterday</h2><div class="card">${list(yMeals, "Nothing logged yesterday.")}</div>
    ${sugarPanel(player, meToken)}`,
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
    ...(g.streak ? [`🔥 ${g.streak}-week streak`] : []),
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
    Promise.all(weeks.map((w) => weekPoints(env, player, w, w === weekStart(today) ? today : addDays(w, 6)))),
    db.statsForRange(env.DB, player.id, from, today),
    db.weightsForPlayer(env.DB, player.id),
  ]);
  const best = Math.max(...scored.filter((w) => w.start !== weekStart(today)).map((w) => w.points), 0);
  const dayHeads = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => `<th class="n">${d}</th>`).join("");
  const weekRows = scored
    .map((w) => {
      const live = w.start === weekStart(today);
      return `<tr><td>${prettyDay(w.start).slice(4)}${live ? ' <span class="muted">· now</span>' : ""}</td>
        ${w.perDay.map((v) => `<td class="n${v === 4 ? " p4" : ""}">${v == null ? '<span class="muted">·</span>' : v}</td>`).join("")}
        <td class="n"><strong>${w.points}</strong>${!live && w.points === best && best > 0 ? " 🏆" : ""}</td></tr>`;
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
    <div class="card table-wrap"><table class="wk"><thead><tr><th>Week of</th>${dayHeads}<th class="n">Total</th></tr></thead>
    <tbody>${weekRows}</tbody></table><p class="rules">Out of 28. 🏆 marks your best finished week. Underlined days are a perfect 4.</p></div>
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

const GOALS = [
  { key: "calOk", icon: "🔥", name: "Calories" },
  { key: "proteinOk", icon: "💪", name: "Protein" },
  { key: "sleepOk", icon: "😴", name: "Sleep" },
  { key: "wakeOk", icon: "⏰", name: "On time" },
] as const;

/** Share of finished days (today is still going) each goal was hit. */
function hitRates(env: Env, { p, stat }: Series, days: string[], today: string): string {
  const r = db.rules(env);
  const done = days.filter((d) => d < today);
  if (!done.length) return `<div class="card muted">Hit rates show up after the first full day.</div>`;
  const scores = done.map((d) => scoreDay(p, stat(d), r, d));
  const cells = GOALS.map((g) => {
    const pct = Math.round((scores.filter((x) => x[g.key]).length / scores.length) * 100);
    return `<div class="rate"><div class="rk">${g.name}</div><div class="rv">${pct}<small>%</small></div>
      <div class="rbar"><span style="width:${pct}%;background:${ACCENT}"></span></div></div>`;
  }).join("");
  return `<div class="card"><div class="rates">${cells}</div><p class="rules">Out of ${done.length} finished day${done.length === 1 ? "" : "s"}.</p></div>`;
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

/** Newest day first, with the four goals as icons, filled when hit. Tap a day for the numbers. */
function dayByDay(env: Env, { p, stat }: Series, days: string[], today: string): string {
  const r = db.rules(env);
  const icons = (sc: ReturnType<typeof scoreDay>) =>
    GOALS.map((g) => `<span class="gi${sc[g.key] ? " hit" : ""}" title="${g.name}: ${sc[g.key] ? "hit" : "missed"}">${g.icon}</span>`).join("");
  const rows = [...days]
    .reverse()
    .map((d) => {
      const sc = scoreDay(p, stat(d), r, d);
      const cell = `<span class="dp" style="--gc:${ACCENT}" aria-label="${sc.points} of 4">${icons(sc)}<b>${sc.points}</b></span>`;
      return `<details class="drow"><summary><span class="dd">${d === today ? "Today" : prettyDay(d)}${d === today ? ' <small class="muted">so far</small>' : ""}</span>${cell}</summary><div class="ddet"><p>${dayDetail(env, p, stat(d))}</p></div></details>`;
    })
    .join("");
  return `<div class="card days one">${rows}
    <p class="rules">🔥 calories · 💪 protein · 😴 ${prettyDuration(r.sleepTargetMinutes).replace(" 00m", "")}+ sleep · ⏰ up on time. Faded means missed. Tap a day for the numbers.</p></div>`;
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
  return `<div class="card tcard tips"><h3>🍬 Sugar</h3><div class="tcols n1"><div class="tcol" style="--gc:${color}">
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
      title: "🔥 Calories",
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
      title: "💪 Protein",
      goal: (p) => (p.protein_target == null ? "no goal" : `reach ${p.protein_target}g`),
      chart: (x) => barChart(bars(x, (s) => food(s, s.protein), (s) => proteinGoalMet(x.p, s, r), (_, v) => `${v}g protein`), ACCENT, () => x.p.protein_target, { h, goal: { dir: "min", label: `${x.p.protein_target}g` } }),
    },
    {
            title: "🥑 Fat",
            goal: (p: Player) => (p.fat_target == null ? "not scored" : `reach ${p.fat_target}g · not scored`),
            chart: (x: Series) => barChart(bars(x, (s) => food(s, s.fat), (s) => x.p.fat_target == null || s.fat >= x.p.fat_target, (_, v) => `${v}g fat`), ACCENT, () => x.p.fat_target, { h, goal: { dir: "min", label: `${x.p.fat_target}g` } }),
          },
    {
            title: "🍞 Carbs",
            goal: (p: Player) => (p.carb_target == null ? "not scored" : `about ${p.carb_target}g · not scored`),
            chart: (x: Series) =>
              barChart(bars(x, (s) => food(s, s.carbs), (s) => x.p.carb_target == null || Math.abs(s.carbs - x.p.carb_target) <= x.p.carb_target * 0.15, (_, v) => `${v}g carbs`), ACCENT, () => x.p.carb_target, { h, goal: { dir: "about", label: `${x.p.carb_target}g` } }),
    },
    {
      title: "😴 Sleep",
      same: true,
      goal: () => `${prettyDuration(r.sleepTargetMinutes).replace(" 00m", "")}+`,
      chart: (x) => barChart(bars(x, (s) => (s.sleepMinutes == null ? null : s.sleepMinutes / 60), (s) => (s.sleepMinutes ?? 0) >= r.sleepTargetMinutes, (s) => prettyDuration(s.sleepMinutes!)), ACCENT, () => r.sleepTargetMinutes / 60, { h, goal: { dir: "min", label: prettyDuration(r.sleepTargetMinutes).replace(" 00m", "") } }),
    },
    {
      title: "⏰ Wake-up",
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
  const weight = `<div class="card tcard tips"><h3>⚖️ Weight</h3><div class="tcols n1"><div class="tcol"><div class="tlabel"><span class="muted">${x.p.goal_weight_lb != null ? `goal ${x.p.goal_weight_lb} lb` : "no goal weight"}</span></div>
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

/** One-tap workout logging and the weekly goal, so Poke doesn't need the newer workout tools. */
async function gymPanel(env: Env, p: Player, meToken: string, today: string): Promise<string> {
  const g = await gymSummary(env, p, today);
  const action = `/me/${esc(meToken)}/workout`;
  const yesterday = addDays(today, -1);
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
  return `<h2 id="gym">Log a workout</h2><div class="card gym-log">
    <form method="post" action="${action}">
      <div class="seg" role="radiogroup" aria-label="Day"><label><input type="radio" name="day" value="today" checked> Today</label><label><input type="radio" name="day" value="yesterday"> Yesterday</label></div>
      <div class="kinds"><button class="pill" name="kind" value="gym">🏋️ Gym</button><button class="pill" name="kind" value="sport">🎾 Sport</button><button class="pill" name="kind" value="run">🏃 Run</button></div>
    </form>${list}
    <form method="post" action="/me/${esc(meToken)}/settings" class="inline">
      <span class="muted wk-line">This week: ${g.thisWeek}${p.workout_target ? ` of ${p.workout_target}` : ""}${g.streak ? ` · 🔥 ${g.streak}-week streak` : ""}</span><span class="muted">Weekly goal</span>
      <select name="workout_target" aria-label="Weekly goal">${p.workout_target ? "" : '<option value="" selected>–</option>'}${goal}</select><button class="pill" type="submit">Save</button>
    </form></div>`;
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
    "Health Tracker",
    `<header class="onboard">${MARK}<h1 class="title wordmark">Health</h1>
      <p class="lede">Food, sleep, and wake-up.<br>Four points a day.</p></header>
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
