import Link from "next/link";
import { campaignAudienceChoices, earlyAccessEmail, saleEmail } from "@sf/core";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { CampaignEditor } from "../CampaignForms";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ early?: string; sale?: string }> }) {
  const { shop, db } = await requireShop("marketing");
  const { early, sale } = await searchParams;
  const options = await campaignAudienceChoices(db, shop.id);
  // From the Sales page: the announcement of a sale's early access, or of the sale itself, written.
  const uuid = (v?: string) => !!v && /^[0-9a-f-]{36}$/.test(v);
  const initial = uuid(early) ? await earlyAccessEmail(db, shop, early!) : uuid(sale) ? await saleEmail(db, shop, sale!) : null;
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
