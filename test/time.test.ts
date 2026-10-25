import { describe, expect, it } from "vitest";
import { addDays, formatOffset, gameDay, parseTime, utcOffsetMinutes, weekStart } from "../src/time";
import { sleepDay } from "../src/game";

const LA = "America/Los_Angeles";

describe("gameDay", () => {
  it("counts 1am as the previous day", () => {
    expect(gameDay(new Date("2026-10-02T01:30:00-07:00"), LA)).toBe("2026-10-01");
  });
  it("rolls over at 4am", () => {
    expect(gameDay(new Date("2026-10-02T03:59:00-07:00"), LA)).toBe("2026-10-01");
    expect(gameDay(new Date("2026-10-02T04:00:00-07:00"), LA)).toBe("2026-10-02");
  });
  it("uses the game timezone, not UTC", () => {
    // 11pm in LA is already the next day in UTC
    expect(gameDay(new Date("2026-10-01T23:00:00-07:00"), LA)).toBe("2026-10-01");
  });
});

describe("sleepDay", () => {
  it("is the calendar day you wake up", () => {
    expect(sleepDay(new Date("2026-10-02T08:00:00-07:00"), LA)).toBe("2026-10-02");
    expect(sleepDay(new Date("2026-10-02T03:00:00-07:00"), LA)).toBe("2026-10-02");
  });
});

describe("dates", () => {
  it("finds Monday as the week start", () => {
    expect(weekStart("2026-10-01")).toBe("2026-09-28"); // Thu -> Mon
    expect(weekStart("2026-09-28")).toBe("2026-09-28");
    expect(weekStart("2026-10-04")).toBe("2026-09-28"); // Sun belongs to the week before
  });
  it("adds days across months", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("computes UTC offsets including DST", () => {
    expect(formatOffset(utcOffsetMinutes(new Date("2026-10-01T12:00:00Z"), LA))).toBe("-07:00");
    expect(formatOffset(utcOffsetMinutes(new Date("2026-12-01T12:00:00Z"), LA))).toBe("-08:00");
    expect(formatOffset(utcOffsetMinutes(new Date("2026-12-01T12:00:00Z"), "Asia/Kolkata"))).toBe("+05:30");
  });
});

describe("parseTime", () => {
  it("keeps an explicit offset", () => {
    expect(parseTime("2026-10-01T23:30:00-07:00", LA)!.toISOString()).toBe("2026-10-02T06:30:00.000Z");
  });
  it("reads offset-less times as game-timezone wall clock, including across DST", () => {
    expect(parseTime("2026-10-01T23:30", LA)!.toISOString()).toBe("2026-10-02T06:30:00.000Z");
    expect(parseTime("2026-12-01T07:00", LA)!.toISOString()).toBe("2026-12-01T15:00:00.000Z");
  });
  it("rejects junk", () => {
    expect(parseTime("last night", LA)).toBeNull();
  });
});
