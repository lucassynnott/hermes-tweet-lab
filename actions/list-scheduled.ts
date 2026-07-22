import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

export default defineAction({
  http: { method: "GET" },
  description: "List scheduled tweets from the Postiz-backed queue.",
  schema: z.object({ _k: z.number().optional() }),
  run: async () => {
    try {
      const r = await fetch(`${TL}/api/tweet-lab/schedule/queue`);
      const d = await r.json();
      const items: any[] = [];
      for (const day of d.days || []) {
        for (const slot of day.slots || day.items || []) {
          if (slot.content || slot.text)
            items.push({ content: slot.content || slot.text, scheduledAt: slot.scheduledAt || slot.time });
        }
      }
      return { items, raw: d.summary || null };
    } catch (e: any) {
      return { items: [], error: e?.message };
    }
  },
});
