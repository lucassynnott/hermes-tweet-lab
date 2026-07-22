import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

// The persistent, SQL-backed "Ready to post" inbox for the current operator.
export default defineAction({
  http: { method: "GET" },
  readOnly: true,
  description: "List the operator's saved/generated tweet drafts (Ready to post).",
  schema: z.object({ _k: z.number().optional() }),
  run: async () => {
    const db = getDb();
    const owner = (await getRequestUserEmail()) || "local@localhost";
    const rows = await db
      .select()
      .from(schema.tweetDrafts)
      .where(eq(schema.tweetDrafts.ownerEmail, owner))
      .orderBy(desc(schema.tweetDrafts.createdAt))
      .limit(50);
    return {
      drafts: rows.map((r) => {
        let segments: string[] | null = null;
        try {
          const p = r.segments ? JSON.parse(r.segments) : null;
          if (Array.isArray(p) && p.length) segments = p;
        } catch {
          /* ignore */
        }
        return {
          id: r.id,
          text: r.text,
          kind: r.kind || "short",
          segments,
          angle: r.angle || undefined,
          gateScore: r.gateScore ?? null,
          status: r.status,
          createdAt: r.createdAt,
        };
      }),
    };
  },
});
