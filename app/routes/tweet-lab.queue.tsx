import { useActionQuery } from "@agent-native/core/client";
import { PageHeader } from "@/components/tweetlab/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
export default function QueuePage() {
  const { data, isLoading } = useActionQuery<any>("list-scheduled", {});
  const items: any[] = (data as any)?.items || [];
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="Queue" subtitle="Scheduled posts via Postiz." />
      {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
        : items.length === 0 ? (
          <Card className="border-dashed"><CardContent className="py-14 text-center text-sm text-muted-foreground">Nothing scheduled yet. Schedule a post from the compose panel.</CardContent></Card>
        ) : (
          <div className="space-y-2">
            {items.map((s, i) => (
              <Card key={i}><CardContent className="flex items-center justify-between gap-4 py-4">
                <p className="text-sm">{s.content || s.text}</p>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{s.scheduledAt || s.date}</span>
              </CardContent></Card>
            ))}
          </div>
        )}
    </div>
  );
}
