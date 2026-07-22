import { defineAction } from "@agent-native/core";
import { z } from "zod";
const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";
export default defineAction({
  http: { method: "GET" },
  description: "Fetch live inspiration tweets from accounts to emulate.",
  schema: z.object({ accounts: z.string().optional(), _k: z.number().optional() }),
  run: async ({ accounts }) => {
    const handles = (accounts || "paulg,naval,sama").split(/[\s,]+/).map(s => s.replace(/^@+/, "").trim()).filter(Boolean);
    try {
      const r = await fetch(`${TL}/api/tweet-lab/live/accounts/tweets`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accounts: handles, limitPerAccount: 8, excludeReplies: true }),
      });
      const d = await r.json();
      return { tweets: d.tweets || [], accounts: d.accounts || [] };
    } catch (e: any) { return { tweets: [], error: e?.message }; }
  },
});
