import { PageHeader } from "@/components/tweetlab/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
export default function ListsPage() {
  return (<div className="mx-auto w-full max-w-3xl px-6 py-10"><PageHeader title="Lists" subtitle="Curated account groups to pull inspiration from." /><Card className="border-dashed"><CardContent className="py-14 text-center text-sm text-muted-foreground">Manage your emulate-account groups in Settings → Accounts to emulate.</CardContent></Card></div>);
}
