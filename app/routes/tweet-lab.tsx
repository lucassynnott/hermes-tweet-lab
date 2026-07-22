import { Outlet, useLocation } from "react-router";
import { TweetLabSidebar } from "@/components/tweetlab/TweetLabSidebar";
import { ComposePanel } from "@/components/tweetlab/ComposePanel";
import { TweetLabProvider } from "@/components/tweetlab/tweetlab-context";

export function meta() {
  return [{ title: "Tweet Lab" }];
}

// Tweet Lab shell: nav sidebar (left) · page (center) · compose/schedule panel
// (right, replacing the agent chat). All Agent-Native components.
export default function TweetLabLayout() {
  const location = useLocation();
  return (
    <TweetLabProvider>
      <div className="flex h-screen overflow-hidden bg-background">
        <TweetLabSidebar />
        <main key={location.pathname} className="tl-page-in flex-1 overflow-y-auto">
          <Outlet />
        </main>
        <ComposePanel />
      </div>
    </TweetLabProvider>
  );
}
