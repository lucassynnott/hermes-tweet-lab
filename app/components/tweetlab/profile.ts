// Read the operator's "accounts to emulate" (saved in Settings → localStorage)
// so generation + inspiration pull from the user's chosen accounts, not defaults.
export function getEmulateAccounts(): string {
  try {
    const p = JSON.parse(localStorage.getItem("tweetLabOperatorProfile") || "{}");
    const a = Array.isArray(p.emulateAccounts) ? p.emulateAccounts : [];
    return a
      .map((h: string) => String(h).replace(/^@+/, "").trim())
      .filter(Boolean)
      .join(",");
  } catch {
    return "";
  }
}

// Read the operator's about-me + topics from Settings (for signal-driven discovery).
export function getOperatorSignal(): { aboutMe: string; topics: string[] } {
  try {
    const p = JSON.parse(localStorage.getItem("tweetLabOperatorProfile") || "{}");
    const aboutMe = typeof p.aboutMe === "string" ? p.aboutMe : "";
    let topics: string[] = [];
    if (Array.isArray(p.topics)) topics = p.topics;
    else if (typeof p.topics === "string") topics = p.topics.split(/[,\n]/);
    topics = topics.map((t) => String(t).trim()).filter(Boolean);
    return { aboutMe, topics };
  } catch {
    return { aboutMe: "", topics: [] };
  }
}
