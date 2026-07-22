import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActionMutation, useActionQuery, cn } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  IconSparkles,
  IconPencil,
  IconCalendarPlus,
  IconBolt,
  IconX,
  IconListDetails,
} from "@tabler/icons-react";
import { useTweetLab } from "@/components/tweetlab/tweetlab-context";
import { GlowButton } from "@/components/tweetlab/GlowButton";
import { OperatorAvatar } from "@/components/tweetlab/OperatorAvatar";
import { ExpandableText } from "@/components/tweetlab/ExpandableText";
import { ThreadModal } from "@/components/tweetlab/ThreadModal";
import { getEmulateAccounts } from "@/components/tweetlab/profile";

type Draft = {
  id: string;
  text: string;
  angle?: string;
  status?: string;
  gateScore?: number | null;
  kind?: string;
  segments?: string[] | null;
};
type GenResult = { drafts: Draft[]; adapter: string; liveSources: number };

const POST_TYPES = [
  { key: "short", label: "Short" },
  { key: "long", label: "Long form" },
  { key: "thread", label: "Thread" },
  { key: "article", label: "Article" },
] as const;
type PostType = (typeof POST_TYPES)[number]["key"];

export function TweetLabHome() {
  const { openCompose, profile } = useTweetLab();
  const queryClient = useQueryClient();
  const [context, setContext] = useState("");
  const [postType, setPostType] = useState<PostType>("short");
  const [threadDraft, setThreadDraft] = useState<Draft | null>(null);

  // Source of truth: the SQL-backed Ready-to-post inbox (persists across reloads + devices).
  const draftsQuery = useActionQuery<{ drafts: Draft[] }>("list-drafts", {});
  const drafts: Draft[] = draftsQuery.data?.drafts ?? [];
  const invalidateDrafts = () =>
    queryClient.invalidateQueries({ queryKey: ["action", "list-drafts"] });

  const generate = useActionMutation<GenResult, any>("generate-tweets", {
    onSuccess: () => invalidateDrafts(),
  });
  const removeDraft = useActionMutation<{ ok: boolean }, { id: string }>("delete-draft", {
    onSuccess: () => invalidateDrafts(),
  });

  const run = () =>
    generate.mutate({
      context: context.trim() || undefined,
      count: postType === "thread" || postType === "article" ? 2 : 4,
      postType,
      accounts: getEmulateAccounts() || undefined,
    });

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-6 py-10">
        {/* Composer */}
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Turn live signal into drafts worth posting.
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Generated from your voice DNA, Obsidian vault, and inspiration accounts via Hermes/goro.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Input
              value={context}
              onChange={(e) => setContext(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="What should the drafts argue? Paste a topic, angle, or operator note…"
              className="h-11 flex-1"
            />
            <GlowButton onClick={run} disabled={generate.isPending} icon={<IconBolt size={20} className="stroke-[1.5]" />}>
              {generate.isPending ? "Generating…" : "Generate"}
            </GlowButton>
          </div>
          {/* Post type */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-muted-foreground">Format</span>
            {POST_TYPES.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setPostType(t.key)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm transition-colors",
                  postType === t.key
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          {generate.isError && (
            <p className="mt-2 text-sm text-destructive">
              {(generate.error as Error)?.message || "Generation failed."}
            </p>
          )}
        </header>

        {/* Ready to post */}
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Ready to post</h2>
          {drafts.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {drafts.length} draft{drafts.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        {drafts.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <div className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
                <IconSparkles size={22} />
              </div>
              <p className="font-medium">No drafts yet.</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                Add a topic (or leave it blank), pick a format, and hit Generate. Drafts are built from your own signal.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {drafts.map((d, i) => {
              const isThread = d.kind === "thread" && Array.isArray(d.segments) && d.segments.length > 1;
              return (
                <Card key={d.id} className="tl-stagger-item tl-lift tl-glow-hover flex flex-col" style={{ ["--i" as any]: i }}>
                  <CardContent className="flex-1 pt-5">
                    <div className="mb-3 flex items-center gap-2">
                      <OperatorAvatar className="size-8 rounded-md text-sm" />
                      <div className="leading-tight">
                        <div className="text-sm font-semibold">{profile.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          @{profile.handle}
                        </div>
                      </div>
                      <div className="ml-auto flex items-center gap-1.5">
                        {isThread && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                            🧵 {d.segments!.length}
                          </span>
                        )}
                        {d.kind && d.kind !== "short" && !isThread && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize text-muted-foreground">
                            {d.kind}
                          </span>
                        )}
                        {d.gateScore != null && (
                          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs">
                            {d.gateScore}
                          </span>
                        )}
                      </div>
                    </div>
                    <ExpandableText text={d.text} clampLines={isThread ? 6 : 10} />
                  </CardContent>
                  <CardFooter className="gap-2 pt-3">
                    {isThread ? (
                      <Button size="sm" className="gap-1.5" onClick={() => setThreadDraft(d)}>
                        <IconListDetails size={15} /> Read thread
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" className="gap-1.5" onClick={() => openCompose({ id: d.id, text: d.text })}>
                          <IconPencil size={15} /> Edit post
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openCompose({ id: d.id, text: d.text })}>
                          <IconCalendarPlus size={15} /> Queue
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto px-2 text-muted-foreground"
                      aria-label="Dismiss draft"
                      onClick={() => removeDraft.mutate({ id: d.id })}
                    >
                      <IconX size={15} />
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <ThreadModal
        open={threadDraft !== null}
        onOpenChange={(v) => !v && setThreadDraft(null)}
        initialSegments={threadDraft?.segments ?? []}
        draftId={threadDraft?.id}
        title="Edit thread"
        onDone={invalidateDrafts}
      />
    </div>
  );
}
