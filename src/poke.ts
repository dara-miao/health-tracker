import type { Env } from "./db";

// Poke's inbound API: the message goes to the player's Poke agent, which texts them.
// Needs a V2 API key from Poke's Kitchen (older pk_ keys don't work with this endpoint).
const POKE_API = "https://poke.com/api/v1/inbound/api-message";

export async function sendToPoke(env: Env, apiKey: string, text: string) {
  const res = await fetch(env.POKE_API_URL ?? POKE_API, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      message: `Update from my health tracker. Text this to me as-is, no commentary:\n\n${text}`,
    }),
  });
  if (!res.ok) throw new Error(`Poke API ${res.status}: ${await res.text()}`);
}
