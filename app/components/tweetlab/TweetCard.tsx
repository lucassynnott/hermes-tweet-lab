import { useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconSparkles, IconPlayerPlayFilled } from "@tabler/icons-react";
import { cn } from "@agent-native/core/client";

export type TweetMedia = {
  type?: string;
  url?: string | null;
  previewImageUrl?: string | null;
  width?: number;
  height?: number;
  altText?: string | null;
};

// X appends t.co permalinks for attached media / quotes to the end of the text.
// Strip the trailing run so the reader sees the full prose, not link noise.
function cleanTweetText(text: string): string {
  return (text || "").replace(/(?:\s*https:\/\/t\.co\/\w+)+\s*$/g, "").trim();
}

function MediaGrid({ media }: { media: TweetMedia[] }) {
  const items = media.filter((m) => m.url || m.previewImageUrl).slice(0, 4);
  if (!items.length) return null;
  return (
    <div
      className={cn(
        "mt-3 grid gap-1 overflow-hidden rounded-xl border border-border",
        items.length === 1 ? "grid-cols-1" : "grid-cols-2",
      )}
    >
      {items.map((m, i) => {
        const isVideo = m.type === "video" || m.type === "animated_gif";
        const src = (isVideo ? m.previewImageUrl || m.url : m.url || m.previewImageUrl) || "";
        const span3 = items.length === 3 && i === 0 ? "row-span-2" : "";
        return (
          <div key={i} className={cn("relative bg-muted", span3)}>
            <img
              src={src}
              alt={m.altText || "tweet media"}
              loading="lazy"
              className={cn(
                "h-full w-full object-cover",
                items.length === 1 ? "max-h-[440px]" : "aspect-square",
              )}
            />
            {isVideo && (
              <span className="absolute inset-0 grid place-items-center">
                <span className="grid size-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                  <IconPlayerPlayFilled size={20} />
                </span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function TweetCard({
  author, handle, text, metrics, action, index, avatarUrl, media,
}: {
  author: string; handle?: string; text: string;
  metrics?: { likeCount?: number; repostCount?: number; replyCount?: number };
  action?: { label: string; onClick: () => void };
  index?: number;
  avatarUrl?: string;
  media?: TweetMedia[];
}) {
  const body = cleanTweetText(text);
  const bodyRef = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = bodyRef.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 4);
  }, [body, expanded]);
  return (
    <Card
      className="tl-stagger-item tl-lift tl-glow-hover flex flex-col"
      style={index != null ? ({ ["--i" as any]: index }) : undefined}
    >
      <CardContent className="flex flex-1 flex-col pt-5">
        <div className="mb-2 flex items-center gap-2">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={author}
              loading="lazy"
              className="size-7 shrink-0 rounded-full object-cover"
              onError={(e) => (e.currentTarget.style.display = "none")}
            />
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">
              {(author || "?").slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="leading-tight">
            <div className="text-sm font-semibold">{author}</div>
            {handle && <div className="font-mono text-xs text-muted-foreground">@{handle}</div>}
          </div>
        </div>
        {body && (
          <>
            <p
              ref={bodyRef}
              className={cn(
                "whitespace-pre-wrap text-sm leading-relaxed",
                !expanded && "line-clamp-[10]",
              )}
            >
              {body}
            </p>
            {(overflows || expanded) && (
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="mt-1 self-start text-sm font-medium text-[#1d9bf0] hover:underline"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            )}
          </>
        )}
        {media && media.length > 0 && <MediaGrid media={media} />}
        <div className="mt-3 flex items-center gap-3 pt-1">
          {metrics && (
            <span className="font-mono text-xs text-muted-foreground">
              ♥ {metrics.likeCount ?? 0} · ↻ {metrics.repostCount ?? 0} · 💬 {metrics.replyCount ?? 0}
            </span>
          )}
          {action && (
            <Button size="sm" variant="outline" className="ml-auto gap-1.5" onClick={action.onClick}>
              <IconSparkles size={14} /> {action.label}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
