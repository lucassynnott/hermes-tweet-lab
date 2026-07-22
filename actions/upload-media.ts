import { defineAction } from "@agent-native/core";
import { z } from "zod";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

// Upload an image/video to Postiz and return a { id, path } media ref that
// schedule-tweet attaches to the post.
export default defineAction({
  description: "Upload an image or video to Postiz for attaching to a scheduled post.",
  schema: z.object({
    filename: z.string(),
    contentType: z.string(),
    dataBase64: z.string().describe("Base64-encoded file contents (data-URL prefix ok)"),
  }),
  run: async (a) => {
    const r = await fetch(`${TL}/api/tweet-lab/upload-media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(a),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || `Upload failed with HTTP ${r.status}`);
    return { id: data.id, path: data.path, name: data.name, type: data.type };
  },
});
