// All "days" in the game are local calendar dates in GAME_TZ that roll over at 4am,
// so a 1am snack or a 2am bedtime still belongs to the day before.
export const ROLLOVER_HOUR = 4;

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function localParts(date: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Minutes east of UTC, e.g. -420 for PDT. */
export function utcOffsetMinutes(date: Date, tz: string): number {
  const p = localParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(date.getTime() / 60000) * 60000) / 60000);
}

export function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function gameDay(date: Date, tz: string): string {
  const p = localParts(new Date(date.getTime() - ROLLOVER_HOUR * 3600_000), tz);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 0 = Sunday, from a YYYY-MM-DD string. */
export function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Weeks run Monday through Sunday. */
export function weekStart(day: string): string {
  return addDays(day, -((weekdayOf(day) + 6) % 7));
}

export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function prettyDay(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(day)]} ${MONTHS[m - 1]} ${d}`;
}

export function prettyTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
}

export function prettyDuration(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${pad(minutes % 60)}m`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parses an ISO 8601 time. If it has no UTC offset, it's read as wall-clock time in `tz`
 * (agents often send "2026-10-01T23:30" without one).
 */
export function parseTime(iso: string, tz: string): Date | null {
  if (/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) {
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const asUtc = Date.parse(`${iso}Z`);
  if (Number.isNaN(asUtc)) return null;
  // Offset can differ across a DST switch, so correct once using the offset at the guessed instant.
  const guess = asUtc - utcOffsetMinutes(new Date(asUtc), tz) * 60_000;
  return new Date(asUtc - utcOffsetMinutes(new Date(guess), tz) * 60_000);
}

/** 510 -> "8:30 AM" */
export function prettyClock(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  return `${h % 12 || 12}:${pad(minutes % 60)} ${h < 12 ? "AM" : "PM"}`;
}
