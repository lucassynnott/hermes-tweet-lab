import { PageHeader } from "@/components/tweetlab/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
export default function MyRepliesPage() {
  return (<div className="mx-auto w-full max-w-3xl px-6 py-10"><PageHeader title="My Replies" subtitle="Replies you've drafted and posted." /><Card className="border-dashed"><CardContent className="py-14 text-center text-sm text-muted-foreground">No replies yet. Draft one from Mentions.</CardContent></Card></div>);
}
