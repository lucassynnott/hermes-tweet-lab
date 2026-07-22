import { NavLink } from "react-router";
import { cn } from "@agent-native/core/client";
import { OperatorAvatar } from "./OperatorAvatar";
import { useTweetLab } from "./tweetlab-context";
import {
  IconHome,
  IconCalendarTime,
  IconChartBar,
  IconMessageCircle,
  IconCompass,
  IconList,
  IconArrowBackUp,
  IconBulb,
  IconPencil,
  IconAddressBook,
  IconSettings,
  IconFlame,
} from "@tabler/icons-react";

type Item = { to: string; label: string; icon: React.ReactNode; end?: boolean };
type Group = { label?: string; items: Item[] };

const ic = (I: any) => <I size={18} stroke={1.6} />;

const GROUPS: Group[] = [
  {
    items: [
      { to: "/tweet-lab", end: true, label: "Ready to post", icon: ic(IconHome) },
      { to: "/tweet-lab/queue", label: "Queue", icon: ic(IconCalendarTime) },
      { to: "/tweet-lab/analytics", label: "Analytics", icon: ic(IconChartBar) },
    ],
  },
  {
    label: "Engage",
    items: [
      { to: "/tweet-lab/mentions", label: "Mentions", icon: ic(IconMessageCircle) },
      { to: "/tweet-lab/discover", label: "Discover", icon: ic(IconCompass) },
      { to: "/tweet-lab/lists", label: "Lists", icon: ic(IconList) },
      { to: "/tweet-lab/my-replies", label: "My Replies", icon: ic(IconArrowBackUp) },
    ],
  },
  {
    label: "Create",
    items: [
      { to: "/tweet-lab/inspiration", label: "Inspiration", icon: ic(IconBulb) },
      { to: "/tweet-lab/ai-writer", label: "AI Writer", icon: ic(IconPencil) },
    ],
  },
  {
    label: "Network",
    items: [
      { to: "/tweet-lab/contacts", label: "Contacts", icon: ic(IconAddressBook) },
      { to: "/tweet-lab/settings", label: "Settings", icon: ic(IconSettings) },
    ],
  },
];

export function TweetLabSidebar() {
  const { profile } = useTweetLab();
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <IconFlame size={18} />
        </span>
        <span className="text-base font-semibold tracking-tight">Tweet Lab</span>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-2 pb-6">
        {GROUPS.map((group, gi) => (
          <div key={gi}>
            {group.label && (
              <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  end={it.end}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150",
                      isActive
                        ? "bg-primary/10 font-semibold text-foreground [&_svg]:text-primary"
                        : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                    )
                  }
                >
                  {it.icon}
                  {it.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="flex items-center gap-2.5 border-t border-border px-3 py-3">
        <OperatorAvatar className="size-8 rounded-full text-sm" />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">{profile.name}</div>
          <div className="truncate font-mono text-xs text-muted-foreground">@{profile.handle}</div>
        </div>
      </div>
    </aside>
  );
}
