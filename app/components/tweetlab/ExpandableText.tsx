import { useEffect, useRef, useState } from "react";
import { cn } from "@agent-native/core/client";

// Clamps long text and reveals a blue "Read more" toggle only when it overflows.
export function ExpandableText({
  text,
  clampLines = 8,
  className,
}: {
  text: string;
  clampLines?: number;
  className?: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 4);
  }, [text, expanded]);
  return (
    <div className="flex flex-col">
      <p
        ref={ref}
        className={cn("whitespace-pre-wrap text-sm leading-relaxed", !expanded && "overflow-hidden", className)}
        style={!expanded ? ({ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: clampLines } as any) : undefined}
      >
        {text}
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
    </div>
  );
}
