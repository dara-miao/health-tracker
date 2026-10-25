import { describe, expect, it } from "vitest";
import { parseSugarTag } from "../src/mcp";

describe("parseSugarTag", () => {
  it("reads total and added sugar and strips the tag", () => {
    expect(parseSugarTag("1 cup vanilla Greek yogurt [sugar 16g, 9g added]")).toEqual({ description: "1 cup vanilla Greek yogurt", sugar_g: 16, added_sugar_g: 9 });
  });
  it("accepts small variations agents write", () => {
    expect(parseSugarTag("banana (sugar: 14g / 0g added)")).toMatchObject({ description: "banana", sugar_g: 14, added_sugar_g: 0 });
    expect(parseSugarTag("cookie [Sugar 12g; added 12g]")).toMatchObject({ description: "cookie", sugar_g: 12, added_sugar_g: 12 });
    expect(parseSugarTag("apple [sugar 19g]")).toMatchObject({ description: "apple", sugar_g: 19, added_sugar_g: null });
  });
  it("leaves descriptions without a tag alone", () => {
    expect(parseSugarTag("2 eggs (scrambled)")).toEqual({ description: "2 eggs (scrambled)", sugar_g: null, added_sugar_g: null });
  });
});
