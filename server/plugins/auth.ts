import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Hermes Tweet Lab",
    tagline:
      "Turn live signal and approved operator context into private drafts worth publishing.",
    features: [
      "Generate short posts, long-form drafts, threads, and articles through Hermes",
      "Review inspiration, mentions, analytics, and scheduled content in one cockpit",
      "Keep every draft private until an operator explicitly approves scheduling",
    ],
  },
  publicPaths: [
    "/api/pages/public",
    "/p",
    "/_agent-native/agent-chat",
    "/_agent-native/agent-engine/status",
    "/_agent-native/builder/callback",
    "/_agent-native/builder/connect",
    "/_agent-native/builder/status",
    "/_agent-native/env-status",
  ],
});
