import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

export default defineAction({
  description:
    "Rewrite a tweet in the operator's voice via Hermes/goro, returning multiple variations to choose from.",
  schema: z.object({
    content: z.string().describe("Tweet text to rewrite"),
    count: z.number().optional().describe("How many variations (1-3)"),
    postType: z.enum(["short", "long", "article"]).optional().describe("Rewrite format"),
  }),
  run: async ({ content, count, postType }) => {
    const r = await fetch(`${TL}/api/tweet-lab/rewrite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // :4173 rewriteTweet expects a sourceTweet with text.
        sourceTweet: {
          text: content,
          author: process.env.TWEET_LAB_X_HANDLE || "example",
        },
        count: Math.max(1, Math.min(count || 3, 3)),
        postType: postType || "short",
        tone: "sharp, useful, no AI slop — the operator's own voice",
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Rewrite failed with HTTP ${r.status}`);
    const list = (Array.isArray(data.candidates) ? data.candidates : data.drafts) || [];
    const variations = list.map((c: any) => (c?.text || "").trim()).filter(Boolean);
    return {
      variations: variations.length ? variations : [content],
      adapter: data.adapter || "goro",
    };
  },
});
