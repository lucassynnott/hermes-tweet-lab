import { useState } from "react";
import { useActionMutation } from "@agent-native/core/client";
import { PageHeader } from "@/components/tweetlab/PageHeader";
import { Button } from "@/components/ui/button";
import { GlowButton } from "@/components/tweetlab/GlowButton";
import { getEmulateAccounts } from "@/components/tweetlab/profile";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useTweetLab } from "@/components/tweetlab/tweetlab-context";
import { IconSparkles, IconPencil } from "@tabler/icons-react";
const PROMPTS = ["Create a list of productivity tips", "Write about my latest project launch", "Tell a story about a recent challenge I overcame"];
export default function AiWriterPage() {
  const { openCompose } = useTweetLab();
  const [q, setQ] = useState("");
  const [drafts, setDrafts] = useState<any[]>([]);
  const gen = useActionMutation<any, any>("generate-tweets", { onSuccess: (r) => setDrafts(r?.drafts || []) });
  const run = (text?: string) => gen.mutate({ context: (text ?? q).trim() || undefined, count: 3, accounts: getEmulateAccounts() || undefined } as any);
  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <PageHeader title="AI Writer" subtitle="Describe what you want to tweet about. Drafted in your voice via Hermes/goro." />
      <div className="mb-4 flex flex-wrap gap-2">
        {PROMPTS.map((p) => (
          <button key={p} onClick={() => { setQ(p); run(p); }} className="rounded-full border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">{p}</button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run()} placeholder="What do you want to tweet about?" className="h-11" />
        <GlowButton disabled={gen.isPending} onClick={() => run()} icon={<IconSparkles size={18} />}>{gen.isPending ? "Writing…" : "Write"}</GlowButton>
      </div>
      <div className="mt-6 space-y-3">
        {drafts.map((d, i) => (
          <Card key={i}><CardContent className="flex items-start justify-between gap-3 pt-5">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{d.text}</p>
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => openCompose({ id: d.id, text: d.text })}><IconPencil size={14} /> Edit</Button>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
