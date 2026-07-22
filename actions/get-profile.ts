import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

// The operator's own X profile (name, handle, avatar).
// Cached in SQL so the avatar persists even when a live X-history fetch returns
// nothing (which is why it "sometimes disappeared").
export default defineAction({
  http: { method: "GET" },
  description: "Get the operator's X profile (name, handle, profile picture), cached.",
  schema: z.object({ _k: z.number().optional() }),
  run: async () => {
    const db = getDb();
    const owner = (await getRequestUserEmail()) || "local@localhost";

    // Cached fallback first.
    const cachedRows = await db
      .select()
      .from(schema.operatorProfile)
      .where(eq(schema.operatorProfile.ownerEmail, owner))
      .limit(1);
    const cached = cachedRows[0] || null;

    // Try a fresh fetch.
    let author: any = {};
    let liveHandle =
      cached?.handle || process.env.TWEET_LAB_X_HANDLE || "example";
    try {
      const r = await fetch(`${TL}/api/tweet-lab/x-history/status`);
      if (r.ok) {
        const d = await r.json();
        liveHandle = d.username || liveHandle;
        author = d?.lastFetch?.tweets?.[0]?.author || {};
      }
    } catch {
      /* best-effort; fall back to cache below */
    }
    const liveAvatar = (author.profileImageUrl || "").replace("_normal.", "_bigger.") || null;

    // Prefer fresh data, but never lose a good avatar to an empty fetch.
    const name = author.name || cached?.name || "OPERATOR";
    const handle = author.username || liveHandle || cached?.handle || "example";
    const avatarUrl = liveAvatar || cached?.avatarUrl || null;

    // Persist whenever we have something worth caching (esp. a real avatar).
    if (avatarUrl || name || handle) {
      const now = new Date().toISOString();
      try {
        if (cached) {
          await db
            .update(schema.operatorProfile)
            .set({ name, handle, avatarUrl, updatedAt: now })
            .where(eq(schema.operatorProfile.ownerEmail, owner));
        } else {
          await db
            .insert(schema.operatorProfile)
            .values({ ownerEmail: owner, name, handle, avatarUrl, updatedAt: now });
        }
      } catch {
        /* cache write is best-effort */
      }
    }

    return { name, handle, avatarUrl };
  },
});
