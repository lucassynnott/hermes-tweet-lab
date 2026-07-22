import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

// Remove a draft from the Ready-to-post inbox (after it's posted/queued/dismissed).
export default defineAction({
  description: "Delete a tweet draft from the Ready-to-post inbox.",
  schema: z.object({ id: z.string().describe("Draft id to remove") }),
  run: async ({ id }) => {
    const db = getDb();
    const owner = (await getRequestUserEmail()) || "local@localhost";
    await db
      .delete(schema.tweetDrafts)
      .where(
        and(eq(schema.tweetDrafts.id, id), eq(schema.tweetDrafts.ownerEmail, owner)),
      );
    return { ok: true, id };
  },
});
