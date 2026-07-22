import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

// Expand a single tweet into a full thread (opening + goro-written follow-ups).
export default defineAction({
  description:
    "Expand a tweet into a thread: keeps the input as the opening and writes follow-up tweets via goro.",
  schema: z.object({ text: z.string().describe("The opening tweet to expand into a thread") }),
  run: async ({ text }) => {
    const r = await fetch(`${TL}/api/tweet-lab/expand-thread`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Expand failed with HTTP ${r.status}`);
    const thread = (Array.isArray(data.thread) ? data.thread : [])
      .map((t: any) => String(t || "").trim())
      .filter(Boolean);
    return { thread: thread.length ? thread : [text], adapter: data.adapter || "goro" };
  },
});
