import { useEffect, useState } from "react";
import { PageHeader } from "@/components/tweetlab/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
const KEY = "tweetLabOperatorProfile";
export default function SettingsPage() {
  const [p, setP] = useState<any>({ aboutMe: "", audience: "", tone: "", topics: "", emulateAccounts: [] as string[] });
  const [acct, setAcct] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => { try { const v = JSON.parse(localStorage.getItem(KEY) || "{}"); setP({ aboutMe: "", audience: "", tone: "", topics: "", emulateAccounts: [], ...v }); } catch {} }, []);
  const save = () => { localStorage.setItem(KEY, JSON.stringify(p)); setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const addAcct = () => { const hs = acct.split(/[\s,]+/).map(s => s.replace(/^@+/, "").trim()).filter(Boolean).map(s => "@" + s); if (hs.length) { setP((x: any) => ({ ...x, emulateAccounts: [...new Set([...(x.emulateAccounts || []), ...hs])] })); setAcct(""); } };
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <PageHeader title="Settings" subtitle="Your voice, audience, and accounts to emulate. Feeds generation alongside your Obsidian vault and X voice DNA." action={<Button onClick={save}>{saved ? "Saved" : "Save profile"}</Button>} />
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-emerald-500"><span className="size-1.5 rounded-full bg-emerald-500" /> Obsidian vault · auto-loaded</span>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-emerald-500"><span className="size-1.5 rounded-full bg-emerald-500" /> X voice DNA · auto-loaded</span>
        </div>
        <label className="block"><span className="text-sm font-medium">About you</span>
          <textarea value={p.aboutMe} onChange={(e) => setP({ ...p, aboutMe: e.target.value })} rows={4} placeholder="Who you are, what you do, your niche…" className="mt-1.5 w-full rounded-md border border-border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block"><span className="text-sm font-medium">Audience</span><Input className="mt-1.5" value={p.audience} onChange={(e) => setP({ ...p, audience: e.target.value })} placeholder="founders, operators" /></label>
          <label className="block"><span className="text-sm font-medium">Voice / tone</span><Input className="mt-1.5" value={p.tone} onChange={(e) => setP({ ...p, tone: e.target.value })} placeholder="sharp, useful, no AI slop" /></label>
        </div>
        <label className="block"><span className="text-sm font-medium">Topics</span><Input className="mt-1.5" value={p.topics} onChange={(e) => setP({ ...p, topics: e.target.value })} placeholder="AI operators, agency leverage" /></label>
        <div>
          <span className="text-sm font-medium">Accounts to emulate</span>
          <div className="mt-1.5 flex gap-2"><Input value={acct} onChange={(e) => setAcct(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAcct()} placeholder="@paulg, @naval" /><Button variant="outline" onClick={addAcct}>Add</Button></div>
          <div className="mt-2 flex flex-wrap gap-2">
            {(p.emulateAccounts || []).map((h: string) => (<span key={h} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs">{h}<button onClick={() => setP((x: any) => ({ ...x, emulateAccounts: x.emulateAccounts.filter((a: string) => a !== h) }))} className="text-muted-foreground hover:text-destructive">×</button></span>))}
            {(p.emulateAccounts || []).length === 0 && <span className="text-xs text-muted-foreground">No accounts yet.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
