import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

// Tweet Lab's proven generation pipeline (Hermes/goro + Obsidian vault + voice
// DNA + live X from inspiration accounts) runs on the existing service. This
// Agent-Native action proxies to it so the AN UI + agent both generate drafts
// through one shared action.
const TL = process.env.TWEET_LAB_API || "http://127.0.0.1:4173";

export default defineAction({
  description:
    "Generate tweet drafts with Hermes/goro from the operator's voice DNA, Obsidian vault, and inspiration accounts.",
  schema: z.object({
    context: z
      .string()
      .optional()
      .describe("Topic, angle, or operator note to steer the drafts"),
    count: z.number().int().min(1).max(6).optional().describe("How many drafts"),
    accounts: z
      .string()
      .optional()
      .describe("Comma-separated X handles to emulate"),
    postType: z
      .enum(["short", "long", "thread", "article"])
      .optional()
      .describe("Draft format"),
  }),
  run: async ({ context, count, accounts, postType }) => {
    const q = encodeURIComponent(context || "");
    const acc = accounts ? `&accounts=${encodeURIComponent(accounts)}` : "";
    let selectedSources: any[] = [];
    let packetWarnings: string[] = [];
    try {
      const cr = await fetch(
        `${TL}/api/tweet-lab/context?query=${q}&maxVaultNotes=5&maxSources=8${acc}`,
      );
      if (cr.ok) {
        const packet = await cr.json();
        packetWarnings = packet.warnings || [];
        selectedSources = (packet.liveX?.tweets || []).map((t: any) => ({
          id: t.id,
          text: t.text,
          author: t.author,
          url: t.url,
          format: "live-x",
          sourceType: "live-x-post",
          suggestedAngle: "Live X inspiration",
        }));
      }
    } catch {
      /* context packet best-effort */
    }
    const gr = await fetch(`${TL}/api/tweet-lab/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        // Goro refuses to fabricate without signal, so when the operator gives
        // no topic and we have no live sources, seed a real default angle.
        context:
          context ||
          (selectedSources.length
            ? ""
            : "AI operators, agency leverage, and building useful systems with AI. Draft sharp, contrarian, useful takes."),
        tone: "sharp, useful, no AI slop",
        count: count || 4,
        postType: postType || "short",
        selectedSources,
      }),
    });
    const data = await gr.json();
    if (!gr.ok)
      throw new Error(data.error || `Generate failed with HTTP ${gr.status}`);
    const drafts = (Array.isArray(data.drafts) ? data.drafts : data.candidates || []).map(
      (d: any, i: number) => {
        const segments = Array.isArray(d.segments) ? d.segments : null;
        return {
          id: d.id || `draft-${Date.now()}-${i}`,
          text: d.text || d.content || "",
          angle: d.angle || "",
          status: d.status || "generated",
          gateScore: d.gateScore ?? d.score ?? null,
          kind: d.kind || (segments ? "thread" : postType || "short"),
          segments,
        };
      },
    );
    // Persist to the SQL-backed Ready-to-post inbox (owner-scoped) so drafts
    // survive reloads and devices.
    try {
      const db = getDb();
      const owner = (await getRequestUserEmail()) || "local@localhost";
      const now = new Date().toISOString();
      if (drafts.length) {
        await db.insert(schema.tweetDrafts).values(
          drafts.map((d: any) => ({
            id: d.id,
            ownerEmail: owner,
            text: d.text,
            kind: d.kind || "short",
            segments: d.segments ? JSON.stringify(d.segments) : null,
            angle: d.angle || null,
            gateScore: d.gateScore ?? null,
            status: d.status || "generated",
            sourceRefs: selectedSources.length
              ? JSON.stringify(selectedSources.map((s: any) => s.url).filter(Boolean))
              : null,
            createdAt: now,
          })),
        );
      }
    } catch {
      /* persistence is best-effort; still return the drafts */
    }

    return {
      drafts,
      adapter: data.adapter || "goro",
      liveSources: selectedSources.length,
      warnings: packetWarnings,
    };
  },
});
