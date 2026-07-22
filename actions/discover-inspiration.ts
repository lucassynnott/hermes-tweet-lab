import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

// "Get Inspiration": reads the operator's signal (about-me, topics, recent
// tweets, Obsidian vault), has goro derive search topics, and pulls recent
// relevant tweets from X to add to the Inspiration feed.
export default defineAction({
  description:
    "Find fresh inspiration tweets from X based on the operator's vault, past tweets, about-me, and topics.",
  schema: z.object({
    aboutMe: z.string().optional().describe("Operator about-me (from Settings)"),
    topics: z.array(z.string()).optional().describe("Topics the operator posts on"),
    maxResults: z.number().optional(),
  }),
  run: async ({ aboutMe, topics, maxResults }) => {
    const r = await fetch(`${TL}/api/tweet-lab/discover/inspire`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        aboutMe: aboutMe || "",
        topics: Array.isArray(topics) ? topics : [],
        maxResults: maxResults || 15,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Get Inspiration failed with HTTP ${r.status}`);
    return {
      tweets: data.results || [],
      topics: data.topics || [],
      warnings: data.warnings || [],
    };
  },
});
