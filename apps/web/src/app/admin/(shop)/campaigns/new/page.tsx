import Link from "next/link";
import { AUDIENCE_LABELS, audienceSizes } from "@sf/core";
import { CAMPAIGN_AUDIENCES } from "@sf/db";
import { requireShop } from "@/lib/server";
import { PageHeader } from "../../PageHeader";
import { CampaignEditor } from "../CampaignForms";

export const metadata = { title: "New campaign" };

export default async function NewCampaignPage() {
  const { shop, db } = await requireShop("marketing");
  const sizes = await audienceSizes(db, shop.id);
  return (
    <main className="pb-12">
      <PageHeader title="New campaign" back={<Link href="/admin/campaigns" className="hint hover:text-ink">← Email campaigns</Link>} />
      <div className="px-4 sm:px-8 max-w-3xl">
        <section className="card p-5">
          <CampaignEditor id={null} audiences={CAMPAIGN_AUDIENCES.map((a) => ({ value: a, label: AUDIENCE_LABELS[a], size: sizes[a] }))} />
        </section>
      </div>
    </main>
  );
}
