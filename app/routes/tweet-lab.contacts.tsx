import { PageHeader } from "@/components/tweetlab/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
export default function ContactsPage() {
  return (<div className="mx-auto w-full max-w-3xl px-6 py-10"><PageHeader title="Contacts" subtitle="Operator contact book — public handles only." /><Card className="border-dashed"><CardContent className="py-14 text-center text-sm text-muted-foreground">No contacts yet.</CardContent></Card></div>);
}
