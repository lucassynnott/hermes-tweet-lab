import { useState } from "react";
import { useActionMutation } from "@agent-native/core/client";
import { PageHeader } from "@/components/tweetlab/PageHeader";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/tweetlab/GlowButton";
import { getEmulateAccounts } from "@/components/tweetlab/profile";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useTweetLab } from "@/components/tweetlab/tweetlab-context";
import { IconCompass, IconPencil } from "@tabler/icons-react";
const TOPICS = ["AI operators", "agency leverage", "workflow automation", "founder loops", "tasteful AI systems"];
export default function DiscoverPage() {
  const { openCompose } = useTweetLab();
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<any[]>([]);
  const gen = useActionMutation<any, any>("generate-tweets", { onSuccess: (r) => setDrafts(r?.drafts || []) });
  const run = (t?: string) => gen.mutate({ context: (t ?? q).trim() || undefined, count: 4, accounts: getEmulateAccounts() || undefined } as any);
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10">
      <PageHeader title="Discover" subtitle="Explore topics and turn them into draft angles." />
      <div className="flex gap-2"><Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="Enter a topic to discover angles…" className="h-11 flex-1" /><GlowButton disabled={gen.isPending} onClick={() => run()} icon={<IconCompass size={18} />}>{gen.isPending ? "…" : "Discover"}</GlowButton></div>
      <div className="mt-3 flex flex-wrap gap-2">{TOPICS.map((t) => <button key={t} onClick={() => { setQ(t); run(t); }} className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">{t}</button>)}</div>
      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        {drafts.map((d, i) => (<Card key={i}><CardContent className="flex items-start justify-between gap-3 pt-5"><p className="whitespace-pre-wrap text-sm leading-relaxed">{d.text}</p><Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => openCompose({ id: d.id, text: d.text })}><IconPencil size={14} /> Edit</Button></CardContent></Card>))}
      </div>
    </div>
  );
}
