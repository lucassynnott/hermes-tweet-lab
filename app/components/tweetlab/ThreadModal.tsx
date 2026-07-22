import { useEffect, useState } from "react";
import { useActionMutation } from "@agent-native/core/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GlowButton } from "./GlowButton";
import { OperatorAvatar } from "./OperatorAvatar";
import { useTweetLab } from "./tweetlab-context";
import { IconPlus, IconTrash, IconCalendarPlus, IconDeviceFloppy } from "@tabler/icons-react";

function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function ThreadModal({
  open,
  onOpenChange,
  initialSegments,
  draftId,
  title = "Thread",
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialSegments: string[];
  draftId?: string;
  title?: string;
  onDone?: () => void;
}) {
  const { profile } = useTweetLab();
  const [segments, setSegments] = useState<string[]>(initialSegments);
  const [when, setWhen] = useState(defaultWhen);
  const [status, setStatus] = useState<{ msg: string; err?: boolean } | null>(null);

  // Re-seed when a new thread is opened.
  useEffect(() => {
    if (open) {
      setSegments(initialSegments.length ? initialSegments : [""]);
      setStatus(null);
    }
  }, [open, initialSegments]);

  const clean = () => segments.map((s) => s.trim()).filter(Boolean);

  const schedule = useActionMutation<any, any>("schedule-tweet", {
    onSuccess: () => {
      setStatus({ msg: "Thread scheduled through Postiz." });
      onDone?.();
      setTimeout(() => onOpenChange(false), 700);
    },
    onError: (e: any) => setStatus({ msg: e?.message || "Schedule failed", err: true }),
  });
  const save = useActionMutation<any, any>("save-draft", {
    onSuccess: () => {
      setStatus({ msg: "Saved to drafts." });
      onDone?.();
      setTimeout(() => onOpenChange(false), 700);
    },
    onError: (e: any) => setStatus({ msg: e?.message || "Save failed", err: true }),
  });

  const setSeg = (i: number, v: string) =>
    setSegments((s) => s.map((x, idx) => (idx === i ? v : x)));
  const addSeg = (i: number) =>
    setSegments((s) => [...s.slice(0, i + 1), "", ...s.slice(i + 1)]);
  const removeSeg = (i: number) =>
    setSegments((s) => (s.length > 1 ? s.filter((_, idx) => idx !== i) : s));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {clean().length} tweet{clean().length === 1 ? "" : "s"} · edit, reorder, then schedule or save.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {segments.map((seg, i) => (
            <div key={i} className="flex gap-3">
              <div className="flex flex-col items-center pt-1">
                <OperatorAvatar className="size-8 rounded-full text-sm" />
                {i < segments.length - 1 && <div className="mt-1 w-px flex-1 bg-border" />}
              </div>
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {i === 0 ? `${profile.name} · opening` : `Reply ${i}`}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {seg.length}
                  </span>
                </div>
                <textarea
                  value={seg}
                  onChange={(e) => setSeg(i, e.target.value)}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-border bg-background p-2.5 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-ring"
                  placeholder={i === 0 ? "Opening tweet…" : "Reply…"}
                />
                <div className="mt-1 flex gap-2">
                  <button
                    type="button"
                    onClick={() => addSeg(i)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
                  >
                    <IconPlus size={13} /> Add below
                  </button>
                  {segments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSeg(i)}
                      className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                    >
                      <IconTrash size={13} /> Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-border px-5 py-4">
          {status && (
            <p className={"text-xs " + (status.err ? "text-destructive" : "text-emerald-500")}>
              {status.msg}
            </p>
          )}
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground">Schedule for</label>
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              disabled={!clean().length || save.isPending}
              onClick={() => save.mutate({ id: draftId, kind: "thread", segments: clean() })}
            >
              <IconDeviceFloppy size={16} /> {save.isPending ? "Saving…" : "Save to drafts"}
            </Button>
            <GlowButton
              size="sm"
              disabled={!clean().length || schedule.isPending}
              icon={<IconCalendarPlus size={16} className="stroke-[1.5]" />}
              onClick={() =>
                schedule.mutate({
                  content: clean()[0],
                  thread: clean(),
                  kind: "thread",
                  scheduledAt: new Date(when).toISOString(),
                  postX: true,
                })
              }
            >
              {schedule.isPending ? "Scheduling…" : "Schedule"}
            </GlowButton>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
