import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

// Upsert a draft into the Ready-to-post inbox (used by "Save to drafts",
// including edited threads from the thread editor).
export default defineAction({
  description: "Create or update a tweet draft (single post or thread) in the Ready-to-post inbox.",
  schema: z.object({
    id: z.string().optional(),
    text: z.string().optional(),
    kind: z.enum(["short", "long", "thread", "article"]).optional(),
    segments: z.array(z.string()).optional(),
  }),
  run: async ({ id, text, kind, segments }) => {
    const db = getDb();
    const owner = (await getRequestUserEmail()) || "local@localhost";
    const cleanSegments = Array.isArray(segments)
      ? segments.map((s) => String(s || "").trim()).filter(Boolean)
      : null;
    const isThread = (kind === "thread" || (cleanSegments && cleanSegments.length > 1)) || false;
    const body = (cleanSegments && cleanSegments.length ? cleanSegments[0] : (text || "")).trim();
    if (!body) throw new Error("Draft is empty.");
    const resolvedKind = isThread ? "thread" : kind || "short";
    const segmentsJson = isThread && cleanSegments ? JSON.stringify(cleanSegments) : null;
    const draftId = id || `draft-${owner.length}-${body.slice(0, 8)}-${body.length}`;

    const existing = id
      ? await db
          .select()
          .from(schema.tweetDrafts)
          .where(and(eq(schema.tweetDrafts.id, id), eq(schema.tweetDrafts.ownerEmail, owner)))
          .limit(1)
      : [];

    if (existing.length) {
      await db
        .update(schema.tweetDrafts)
        .set({ text: body, kind: resolvedKind, segments: segmentsJson })
        .where(and(eq(schema.tweetDrafts.id, id!), eq(schema.tweetDrafts.ownerEmail, owner)));
      return { ok: true, id: id!, updated: true };
    }

    await db.insert(schema.tweetDrafts).values({
      id: draftId,
      ownerEmail: owner,
      text: body,
      kind: resolvedKind,
      segments: segmentsJson,
      status: "draft",
      createdAt: new Date().toISOString(),
    });
    return { ok: true, id: draftId, updated: false };
  },
});
