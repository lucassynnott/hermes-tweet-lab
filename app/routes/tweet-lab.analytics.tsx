import { useActionQuery } from "@agent-native/core/client";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/tweetlab/PageHeader";

type Analytics = {
  followers: number | null;
  impressions: number;
  engagement: number;
  likes: number;
  reposts: number;
  replies: number;
  tweetCount: number;
};

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="tl-lift tl-glow-hover">
      <CardContent className="pt-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 font-mono text-3xl font-semibold tabular-nums">{value}</div>
        {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
        <div className="mt-3 h-0.5 w-12 rounded bg-primary/70" />
      </CardContent>
    </Card>
  );
}

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString();

export default function AnalyticsPage() {
  const { data, isLoading } = useActionQuery<Analytics>("get-analytics", {});
  const a = data;
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <PageHeader title="Analytics" subtitle="Live X account metrics plus local draft activity." />
      <div className="tl-stagger-grid grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Metric label="Followers" value={isLoading ? "…" : fmt(a?.followers)} sub="live from X profile" />
        <Metric label="Impressions" value={isLoading ? "…" : fmt(a?.impressions)} sub="your recent posts" />
        <Metric label="Engagement" value={isLoading ? "…" : fmt(a?.engagement)} sub={`${fmt(a?.likes)} likes · ${fmt(a?.reposts)} reposts · ${fmt(a?.replies)} replies`} />
        <Metric label="Posts analyzed" value={isLoading ? "…" : fmt(a?.tweetCount)} sub="from X history" />
      </div>
    </div>
  );
}
