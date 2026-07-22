import { useEffect, useState } from "react";
import { cn } from "@agent-native/core/client";
import { useTweetLab } from "./tweetlab-context";

// The operator's avatar: real X profile picture when available, falling back to
// the deep-orange "L" monogram if the image is missing OR fails to load.
export function OperatorAvatar({ className }: { className?: string }) {
  const { profile } = useTweetLab();
  const [errored, setErrored] = useState(false);

  // Reset the error flag when the avatar URL changes (e.g. profile loads in).
  useEffect(() => setErrored(false), [profile.avatarUrl]);

  if (profile.avatarUrl && !errored) {
    return (
      <img
        src={profile.avatarUrl}
        alt={profile.name}
        loading="lazy"
        className={cn("shrink-0 object-cover", className)}
        onError={() => setErrored(true)}
      />
    );
  }
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center bg-primary font-semibold text-primary-foreground",
        className,
      )}
    >
      {(profile.name || "L").slice(0, 1).toUpperCase()}
    </span>
  );
}
