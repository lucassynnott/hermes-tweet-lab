import { useEffect, useMemo, useRef, useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { Button } from "@/components/ui/button";
import { GlowButton } from "./GlowButton";
import { OperatorAvatar } from "./OperatorAvatar";
import { ThreadModal } from "./ThreadModal";
import { useTweetLab } from "./tweetlab-context";
import {
  IconSparkles,
  IconCalendarPlus,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconPhotoPlus,
  IconX,
  IconLoader2,
  IconPlayerPlayFilled,
  IconListDetails,
} from "@tabler/icons-react";
import { cn } from "@agent-native/core/client";

type Attachment = {
  key: string;
  name: string;
  preview: string;
  isVideo: boolean;
  id?: string;
  path?: string;
  uploading: boolean;
  error?: boolean;
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <span
        className={
          "relative h-5 w-9 shrink-0 rounded-full transition-colors " +
          (checked ? "bg-primary" : "bg-muted")
        }
      >
        <span
          className={
            "absolute top-0.5 size-4 rounded-full bg-white transition-transform " +
            (checked ? "translate-x-4" : "translate-x-0.5")
          }
        />
      </span>
    </button>
  );
}

function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ComposePanel() {
  const { composeText, setComposeText, refresh, refreshKey, profile } = useTweetLab();
  const [tab, setTab] = useState<"compose" | "scheduled">("compose");
  const [when, setWhen] = useState(defaultWhen);
  const [advanced, setAdvanced] = useState(false);
  const [opts, setOpts] = useState({
    postX: true,
    postBluesky: false,
    autoRetweet: false,
    autoPlug: false,
    autoDm: false,
    autoDelete: false,
    superFollowersOnly: false,
  });
  const [status, setStatus] = useState<{ msg: string; err?: boolean } | null>(null);
  const [media, setMedia] = useState<Attachment[]>([]);
  const [variations, setVariations] = useState<string[]>([]);
  const [varIdx, setVarIdx] = useState(0);
  const [threadOpen, setThreadOpen] = useState(false);
  const [threadSegments, setThreadSegments] = useState<string[]>([]);
  const [format, setFormat] = useState<"short" | "long" | "thread" | "article">("short");
  const fileRef = useRef<HTMLInputElement>(null);

  const runRewrite = () => {
    if (!composeText.trim()) return;
    if (format === "thread") expand.mutate({ text: composeText });
    else rewrite.mutate({ content: composeText, count: 3, postType: format } as any);
  };

  const expand = useActionMutation<{ thread: string[] }, { text: string }>("expand-thread", {
    onSuccess: (r) => {
      const t = (r?.thread || []).filter(Boolean);
      if (t.length) {
        setThreadSegments(t);
        setThreadOpen(true);
      } else {
        setStatus({ msg: "Couldn't expand into a thread.", err: true });
      }
    },
    onError: (e: any) => setStatus({ msg: e?.message || "Expand failed", err: true }),
  });

  const count = composeText.length;
  const setOpt = (k: keyof typeof opts) => (v: boolean) => setOpts((o) => ({ ...o, [k]: v }));
  const uploading = media.some((m) => m.uploading);
  const readyMedia = media.filter((m) => m.id || m.path).map((m) => ({ id: m.id, path: m.path }));

  const onPickFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    for (const file of files) {
      const key = `${file.name}-${file.size}-${Math.round(file.lastModified)}`;
      const isVideo = file.type.startsWith("video/");
      setMedia((m) => [
        ...m,
        { key, name: file.name, preview: URL.createObjectURL(file), isVideo, uploading: true },
      ]);
      try {
        const dataBase64 = await fileToDataUrl(file);
        const res = await fetch("/_agent-native/actions/upload-media", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Agent-Native-Frontend": "1" },
          body: JSON.stringify({ filename: file.name, contentType: file.type || "application/octet-stream", dataBase64 }),
        }).then((r) => r.json());
        if (!res?.path && !res?.id) throw new Error(res?.error || "upload failed");
        setMedia((m) => m.map((x) => (x.key === key ? { ...x, id: res.id, path: res.path, uploading: false } : x)));
      } catch {
        setMedia((m) => m.map((x) => (x.key === key ? { ...x, uploading: false, error: true } : x)));
      }
    }
  };
  const removeMedia = (key: string) => setMedia((m) => m.filter((x) => x.key !== key));

  const rewrite = useActionMutation<{ variations: string[] }, { content: string; count: number }>(
    "rewrite-tweet",
    {
      onSuccess: (r) => {
        const v = (r?.variations || []).filter(Boolean);
        setVariations(v);
        setVarIdx(0);
        setStatus(
          v.length
            ? { msg: `${v.length} variation${v.length === 1 ? "" : "s"} from goro — pick one.` }
            : { msg: "No variations returned.", err: true },
        );
      },
      onError: (e: any) => setStatus({ msg: e?.message || "Rewrite failed", err: true }),
    },
  );
  const schedule = useActionMutation<any, any>("schedule-tweet", {
    onSuccess: () => { setStatus({ msg: "Scheduled through Postiz." }); setMedia([]); refresh(); },
    onError: (e: any) => setStatus({ msg: e?.message || "Schedule failed", err: true }),
  });

  const scheduled = useActionQuery<any>("list-scheduled", { _k: refreshKey } as any, {
    enabled: tab === "scheduled",
  } as any);
  const scheduledItems: any[] = useMemo(() => {
    const d: any = scheduled.data;
    return d?.items || d?.scheduled || (Array.isArray(d) ? d : []);
  }, [scheduled.data]);

  useEffect(() => { if (composeText) setTab("compose"); }, [composeText]);

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-border bg-card/40">
      {/* tabs */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        {(["compose", "scheduled"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors " +
              (tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground")
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "compose" ? (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <div className="flex items-center gap-2.5">
            <OperatorAvatar className="size-8 rounded-md text-sm" />
            <div className="leading-tight">
              <div className="text-sm font-semibold">{profile.name}</div>
              <div className="font-mono text-xs text-muted-foreground">@{profile.handle}</div>
            </div>
          </div>

          <textarea
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            placeholder="What's happening?"
            className="min-h-[150px] w-full resize-y rounded-lg border border-border bg-background p-3 text-base leading-relaxed outline-none focus:ring-2 focus:ring-ring"
          />
          {media.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {media.map((m) => (
                <div key={m.key} className="group/att relative aspect-square overflow-hidden rounded-lg border border-border bg-muted">
                  <img src={m.preview} alt={m.name} className="h-full w-full object-cover" />
                  {m.isVideo && !m.uploading && (
                    <span className="absolute inset-0 grid place-items-center">
                      <span className="grid size-8 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                        <IconPlayerPlayFilled size={15} />
                      </span>
                    </span>
                  )}
                  {m.uploading && (
                    <span className="absolute inset-0 grid place-items-center bg-background/60">
                      <IconLoader2 size={18} className="animate-spin text-primary" />
                    </span>
                  )}
                  {m.error && (
                    <span className="absolute inset-0 grid place-items-center bg-destructive/15 text-[10px] font-semibold text-destructive">
                      failed
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => removeMedia(m.key)}
                    aria-label="Remove attachment"
                    className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover/att:opacity-100"
                  >
                    <IconX size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={onPickFiles} />

          {/* Rewrite format */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs font-medium text-muted-foreground">Format</span>
            {([
              ["short", "Short"],
              ["long", "Long"],
              ["thread", "Thread"],
              ["article", "Article"],
            ] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFormat(k)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-xs transition-colors",
                  format === k
                    ? "border-primary bg-primary/10 font-medium text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
              <IconPhotoPlus size={15} /> Media
            </Button>
            <span className={"font-mono text-xs " + (count > 280 && format === "short" ? "text-destructive" : "text-muted-foreground")}>{count}</span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto gap-1.5"
              disabled={!composeText.trim() || rewrite.isPending || expand.isPending}
              onClick={runRewrite}
            >
              {format === "thread" ? (
                <>
                  <IconListDetails size={15} /> {expand.isPending ? "Expanding…" : "Expand to thread"}
                </>
              ) : (
                <>
                  <IconSparkles size={15} /> {rewrite.isPending ? "Rewriting…" : "Rewrite"}
                </>
              )}
            </Button>
          </div>

          {rewrite.isPending && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                <IconSparkles size={14} className="animate-pulse text-primary" />
                <span>goro is rewriting in your voice</span>
                <span className="tl-dots inline-flex gap-0.5">
                  <span className="size-1 rounded-full bg-primary" />
                  <span className="size-1 rounded-full bg-primary" />
                  <span className="size-1 rounded-full bg-primary" />
                </span>
              </div>
              <div className="space-y-2">
                <div className="tl-skeleton h-3 w-full rounded" />
                <div className="tl-skeleton h-3 w-[94%] rounded" />
                <div className="tl-skeleton h-3 w-[80%] rounded" />
                <div className="tl-skeleton h-3 w-[88%] rounded" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <div className="flex justify-center gap-1">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="size-1.5 rounded-full bg-border" />
                  ))}
                </div>
                <div className="tl-skeleton h-7 w-20 rounded-md" />
              </div>
            </div>
          )}

          {!rewrite.isPending && variations.length > 0 && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  Rewrite {varIdx + 1} of {variations.length} · goro
                </span>
                <button
                  type="button"
                  onClick={() => setVariations([])}
                  aria-label="Dismiss variations"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <IconX size={14} />
                </button>
              </div>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed">
                {variations[varIdx]}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7"
                    disabled={variations.length < 2}
                    onClick={() => setVarIdx((i) => (i - 1 + variations.length) % variations.length)}
                    aria-label="Previous variation"
                  >
                    <IconChevronLeft size={15} />
                  </Button>
                  <div className="flex items-center gap-1">
                    {variations.map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setVarIdx(i)}
                        aria-label={`Variation ${i + 1}`}
                        className={cn(
                          "size-1.5 rounded-full transition-colors",
                          i === varIdx ? "bg-primary" : "bg-border hover:bg-muted-foreground",
                        )}
                      />
                    ))}
                  </div>
                  <Button
                    size="icon"
                    variant="outline"
                    className="size-7"
                    disabled={variations.length < 2}
                    onClick={() => setVarIdx((i) => (i + 1) % variations.length)}
                    aria-label="Next variation"
                  >
                    <IconChevronRight size={15} />
                  </Button>
                </div>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setComposeText(variations[varIdx]);
                    setStatus({ msg: "Loaded into the editor." });
                  }}
                >
                  Use this
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Toggle label="Post on X" checked={opts.postX} onChange={setOpt("postX")} />
            <Toggle label="Post on BlueSky" checked={opts.postBluesky} onChange={setOpt("postBluesky")} />
          </div>

          <button onClick={() => setAdvanced((a) => !a)}
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground">
            <IconChevronDown size={15} className={advanced ? "rotate-180 transition-transform" : "transition-transform"} />
            Advanced auto-actions
          </button>
          {advanced && (
            <div className="space-y-2">
              <Toggle label="Auto-retweet" hint="Boost from a second account" checked={opts.autoRetweet} onChange={setOpt("autoRetweet")} />
              <Toggle label="Auto-plug" hint="Reply with a CTA after it lands" checked={opts.autoPlug} onChange={setOpt("autoPlug")} />
              <Toggle label="Auto-DM" hint="DM engagers automatically" checked={opts.autoDm} onChange={setOpt("autoDm")} />
              <Toggle label="Auto-delete" hint="Remove after a set time" checked={opts.autoDelete} onChange={setOpt("autoDelete")} />
              <Toggle label="Super-followers only" checked={opts.superFollowersOnly} onChange={setOpt("superFollowersOnly")} />
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Schedule for</label>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
          </div>

          {status && (
            <p className={"text-xs " + (status.err ? "text-destructive" : "text-emerald-500")}>{status.msg}</p>
          )}

          <div className="mt-auto pt-2">
            <GlowButton block disabled={!composeText.trim() || schedule.isPending || uploading}
              icon={<IconCalendarPlus size={18} className="stroke-[1.5]" />}
              onClick={() => schedule.mutate({ content: composeText, scheduledAt: new Date(when).toISOString(), media: readyMedia, ...opts })}>
              {schedule.isPending ? "Scheduling…" : uploading ? "Uploading…" : "Schedule"}
            </GlowButton>
          </div>
        </div>
      ) : (
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {scheduled.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : scheduledItems.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing scheduled yet.</p>
          ) : (
            scheduledItems.map((s, i) => (
              <div key={i} className="rounded-md border border-border bg-card p-3">
                <p className="text-sm">{s.content || s.text}</p>
                <p className="mt-1 font-mono text-xs text-muted-foreground">{s.scheduledAt || s.date}</p>
              </div>
            ))
          )}
        </div>
      )}

      <ThreadModal
        open={threadOpen}
        onOpenChange={setThreadOpen}
        initialSegments={threadSegments}
        title="Expand to thread"
        onDone={refresh}
      />
    </aside>
  );
}
