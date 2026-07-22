import { useActionQuery } from "@agent-native/core/client";
import { PageHeader } from "@/components/tweetlab/PageHeader";
import { TweetCard } from "@/components/tweetlab/TweetCard";
import { Card, CardContent } from "@/components/ui/card";
import { useTweetLab } from "@/components/tweetlab/tweetlab-context";
export default function MentionsPage() {
  const { openCompose } = useTweetLab();
  const { data, isLoading } = useActionQuery<any>("get-mentions", {});
  const mentions: any[] = (data as any)?.mentions || [];
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="Mentions" subtitle="Live mentions of the configured operator account across X." />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : mentions.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-14 text-center text-sm text-muted-foreground">No recent mentions found.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {mentions.map((m, i) => (
              <TweetCard key={i} index={i}
                author={m.author?.name || m.author?.username || m.author || "unknown"}
                avatarUrl={(m.author&&m.author.profileImageUrl)||undefined} handle={m.author?.username || (typeof m.author === "string" ? m.author : undefined)}
                text={m.text || ""} metrics={m.metrics} media={m.media}
                action={{ label: "Draft reply", onClick: () => openCompose({ text: "" }) }} />
            ))}
          </div>
        )}
    </div>
  );
}
