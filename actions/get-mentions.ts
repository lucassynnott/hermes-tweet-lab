import { defineAction } from "@agent-native/core";
import { z } from "zod";
const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";
export default defineAction({
  http: { method: "GET" },
  description: "Fetch live X mentions of the operator account.",
  schema: z.object({ _k: z.number().optional() }),
  run: async () => {
    const r = await fetch(`${TL}/api/tweet-lab/mentions/fetch`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accounts: [process.env.TWEET_LAB_X_HANDLE || "example"],
      }),
    });
    const d = await r.json();
    return { mentions: d.mentions || [], provider: d.provider || null, warnings: d.warnings || [] };
  },
});
