import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useActionQuery } from "@agent-native/core/client";

const PROFILE_CACHE_KEY = "tweetLabProfile";

export type ComposeTarget = {
  id?: string;
  text: string;
};

export type OperatorProfile = { name: string; handle: string; avatarUrl: string | null };

type TweetLabCtx = {
  composeText: string;
  setComposeText: (t: string) => void;
  editingId: string | null;
  /** Open a draft (or blank) in the right compose panel. */
  openCompose: (target?: ComposeTarget) => void;
  /** Bump to force compose-panel lists (drafts/scheduled) to refetch. */
  refreshKey: number;
  refresh: () => void;
  /** The operator's X profile (name, handle, avatar), fetched once. */
  profile: OperatorProfile;
};

const Ctx = createContext<TweetLabCtx | null>(null);

export function TweetLabProvider({ children }: { children: ReactNode }) {
  const [composeText, setComposeText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const openCompose = useCallback((target?: ComposeTarget) => {
    setComposeText(target?.text ?? "");
    setEditingId(target?.id ?? null);
  }, []);
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Client cache so the avatar shows instantly and never blanks on a transiently
  // empty fetch. Backed by the SQL cache in the get-profile action.
  const [cachedProfile, setCachedProfile] = useState<OperatorProfile | null>(null);
  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem(PROFILE_CACHE_KEY) || "null");
      if (c && typeof c === "object") setCachedProfile(c);
    } catch {
      /* ignore */
    }
  }, []);

  const profileQuery = useActionQuery<OperatorProfile>("get-profile", {});
  const live = profileQuery.data;
  useEffect(() => {
    if (live && live.avatarUrl) {
      try {
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(live));
      } catch {
        /* ignore */
      }
      setCachedProfile(live);
    }
  }, [live]);

  // Prefer fresh data with an avatar; otherwise keep the cached profile so the
  // picture doesn't disappear.
  const profile: OperatorProfile =
    live && live.avatarUrl
      ? live
      : cachedProfile || live || { name: "OPERATOR", handle: "example", avatarUrl: null };

  return (
    <Ctx.Provider
      value={{ composeText, setComposeText, editingId, openCompose, refreshKey, refresh, profile }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useTweetLab() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTweetLab must be used within TweetLabProvider");
  return v;
}
