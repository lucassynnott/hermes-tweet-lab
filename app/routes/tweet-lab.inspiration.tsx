import { useState, useEffect } from "react";
import { useActionQuery, useActionMutation } from "@agent-native/core/client";
import { PageHeader } from "@/components/tweetlab/PageHeader";
import { TweetCard } from "@/components/tweetlab/TweetCard";
import { GlowButton } from "@/components/tweetlab/GlowButton";
import { Card, CardContent } from "@/components/ui/card";
import { useTweetLab } from "@/components/tweetlab/tweetlab-context";
import { getEmulateAccounts, getOperatorSignal } from "@/components/tweetlab/profile";
import { IconSparkles } from "@tabler/icons-react";

export default function InspirationPage() {
  const { openCompose } = useTweetLab();
  // null until the client reads Settings → only fetch once, with the right accounts.
  const [accounts, setAccounts] = useState<string | null>(null);
  useEffect(() => { setAccounts(getEmulateAccounts()); }, []);
  const { data, isLoading } = useActionQuery<any>(
    "get-inspiration",
    accounts ? { accounts } : {},
    { enabled: accounts !== null } as any,
  );

  const [discovered, setDiscovered] = useState<any[]>([]);
  const [discoverNote, setDiscoverNote] = useState<string | null>(null);
  const discover = useActionMutation<{ tweets: any[]; topics: string[]; warnings: string[] }, any>(
    "discover-inspiration",
    {
      onSuccess: (r) => {
        setDiscovered(r?.tweets || []);
        const topics = r?.topics || [];
        setDiscoverNote(
          (r?.tweets || []).length
            ? `Found ${r.tweets.length} fresh posts${topics.length ? ` · ${topics.slice(0, 4).join(", ")}` : ""}`
            : (r?.warnings?.[0] || "No fresh posts found — try adding more in Settings."),
        );
      },
      onError: (e: any) => setDiscoverNote(e?.message || "Get Inspiration failed."),
    },
  );

  const runDiscover = () => {
    const { aboutMe, topics } = getOperatorSignal();
    setDiscoverNote(null);
    discover.mutate({ aboutMe, topics });
  };

  const accountTweets: any[] = (data as any)?.tweets || [];
  // Discovered (signal-driven) first, then the account feed; dedupe.
  const seen = new Set<string>();
  const tweets = [...discovered, ...accountTweets].filter((t) => {
    const k = t.id || t.url || t.text || "";
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const loadingFeed = accounts === null || isLoading;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageHeader title="Inspiration" subtitle="Live posts from accounts you emulate, plus fresh finds." />
        <GlowButton
          size="sm"
          onClick={runDiscover}
          disabled={discover.isPending}
          icon={<IconSparkles size={17} className="stroke-[1.5]" />}
        >
          {discover.isPending ? "Finding…" : "Get Inspiration"}
        </GlowButton>
      </div>

      {discoverNote && (
        <p className={"mb-4 text-sm " + (discover.isError ? "text-destructive" : "text-muted-foreground")}>
          {discoverNote}
        </p>
      )}

      {discover.isPending && (
        <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="overflow-hidden">
              <CardContent className="space-y-3 pt-5">
                <div className="flex items-center gap-2">
                  <div className="tl-skeleton size-7 rounded-full" />
                  <div className="tl-skeleton h-3 w-28 rounded" />
                </div>
                <div className="tl-skeleton h-3 w-full rounded" />
                <div className="tl-skeleton h-3 w-[92%] rounded" />
                <div className="tl-skeleton h-3 w-[70%] rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {loadingFeed && !discovered.length && !discover.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tweets.length === 0 && !discover.isPending ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center text-sm text-muted-foreground">
            No inspiration yet. Hit <span className="font-medium text-foreground">Get Inspiration</span> for fresh finds, or add accounts to emulate in Settings.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {tweets.map((t, i) => (
            <TweetCard
              key={t.id || t.url || i}
              index={i}
              author={t.author?.name || t.author?.username || "unknown"}
              avatarUrl={t.author?.profileImageUrl}
              handle={t.author?.username}
              text={t.text || ""}
              metrics={t.metrics}
              media={t.media}
              action={{ label: "Remix", onClick: () => openCompose({ text: t.text || "" }) }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
