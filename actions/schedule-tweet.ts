import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

export default defineAction({
  description:
    "Schedule a tweet through Postiz with optional auto-actions (retweet, plug, DM, delete) and X/BlueSky targets.",
  schema: z.object({
    content: z.string().describe("Tweet text"),
    scheduledAt: z.string().describe("ISO datetime to post"),
    autoRetweet: z.boolean().optional(),
    autoPlug: z.boolean().optional(),
    autoDm: z.boolean().optional(),
    autoDelete: z.boolean().optional(),
    superFollowersOnly: z.boolean().optional(),
    postX: z.boolean().optional(),
    postBluesky: z.boolean().optional(),
    media: z
      .array(z.object({ id: z.string().optional(), path: z.string().optional() }))
      .optional()
      .describe("Postiz media refs from upload-media to attach to the post"),
    thread: z.array(z.string()).optional().describe("Thread tweets (posts as a thread)"),
    kind: z.enum(["short", "long", "thread", "article"]).optional(),
  }),
  run: async (a) => {
    const r = await fetch(`${TL}/api/tweet-lab/schedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: a.content,
        scheduledAt: a.scheduledAt,
        timezone: "UTC",
        integrationId: "",
        thread: a.thread && a.thread.length ? a.thread : undefined,
        kind: a.kind || (a.thread && a.thread.length ? "thread" : undefined),
        media: a.media || [],
        settings: {
          autoRetweet: !!a.autoRetweet,
          autoPlug: !!a.autoPlug,
          autoDm: !!a.autoDm,
          autoDelete: !!a.autoDelete,
          superFollowersOnly: !!a.superFollowersOnly,
        },
        targets: { x: a.postX !== false, bluesky: !!a.postBluesky },
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Schedule failed with HTTP ${r.status}`);
    return { ok: true, postiz: data.postiz ?? data };
  },
});
