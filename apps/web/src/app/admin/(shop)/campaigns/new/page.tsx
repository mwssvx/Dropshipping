import Link from "next/link";
import { campaignAudienceChoices, earlyAccessEmail } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { CampaignEditor } from "../CampaignForms";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ early?: string }> }) {
  const { shop, db } = await requireShop("marketing");
  const { early } = await searchParams;
  const options = await campaignAudienceChoices(db, shop.id);
  // From a sale's early access: the announcement, written.
  const initial = early && /^[0-9a-f-]{36}$/.test(early) ? await earlyAccessEmail(db, shop, early) : null;
  return (
    <main className="pb-12">
      <PageHeader title="New campaign" back={<Link href="/admin/campaigns" className="hint hover:text-ink">← Email campaigns</Link>} />
      <div className="px-4 sm:px-8 max-w-3xl">
        <section className="card p-5">
          <CampaignEditor id={null} initial={initial ?? undefined} {...options} />
        </section>
      </div>
    </main>
  );
}
