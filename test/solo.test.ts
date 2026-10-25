import { describe, expect, it } from "vitest";
import { weekLine } from "../src/game";
import { handleMcp } from "../src/mcp";
import { sha256, type Env } from "../src/db";

describe("weekLine", () => {
  it("shows the total, each day, and the week's sleep", () => {
    expect(weekLine({ start: "2026-10-19", days: [], perDay: [3, 4, 2, null, null, null, null], points: 9, sleepMinutes: 1290 })).toBe(
      "9 pts (3 4 2 · · · ·), 21h 30m sleep",
    );
  });
});

describe("MCP access", () => {
  // A players table with the owner and one other player, looked up by key hash.
  async function envWith(owner: string) {
    const rows = [
      { id: 1, name: "Dara", hash: await sha256("hb_dara") },
      { id: 2, name: "Someone", hash: await sha256("hb_other") },
    ];
    const DB = {
      prepare: () => ({ bind: (hash: string) => ({ first: async () => rows.find((r) => r.hash === hash) ?? null }) }),
    } as unknown as D1Database;
    return { DB, OWNER_NAME: owner, GAME_TZ: "America/Los_Angeles" } as Env;
  }
  const ping = (key: string) =>
    new Request("https://x/mcp", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });

  it("lets the owner in", async () => {
    expect((await handleMcp(ping("hb_dara"), await envWith("Dara"))).status).toBe(200);
  });
  it("refuses any other player's key, and unknown keys", async () => {
    expect((await handleMcp(ping("hb_other"), await envWith("Dara"))).status).toBe(401);
    expect((await handleMcp(ping("hb_nope"), await envWith("Dara"))).status).toBe(401);
  });
});
