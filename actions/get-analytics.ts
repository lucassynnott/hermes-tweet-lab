import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

export default defineAction({
  http: { method: "GET" },
  description: "Get live X analytics (followers, impressions, engagement) for the operator account.",
  schema: z.object({ _k: z.number().optional() }),
  run: async () => {
    const r = await fetch(`${TL}/api/tweet-lab/x-analytics`);
    if (!r.ok) throw new Error(`Analytics failed HTTP ${r.status}`);
    return await r.json();
  },
});
