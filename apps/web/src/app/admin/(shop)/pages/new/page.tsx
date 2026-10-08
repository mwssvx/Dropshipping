import Link from "next/link";
import { requireShop } from "@/lib/server";
import { createPageAction } from "../../../store-actions";
import { PageHeader } from "../../PageHeader";
import { PageForm } from "../PageForm";

export const metadata = { title: "Add page" };

export default async function NewPagePage({ searchParams }: { searchParams: Promise<{ title?: string }> }) {
  await requireShop("pages");
  const title = ((await searchParams).title ?? "").slice(0, 120);
  return (
    <main className="pb-12">
      <PageHeader title="Add page" back={<Link href="/admin/pages" className="hint hover:text-ink">← Pages</Link>} />
      <div className="px-4 sm:px-8">
        <PageForm action={createPageAction} submitLabel="Save page" initial={{ title, handle: "", body: "", seoDescription: "", published: true }} />
      </div>
    </main>
  );
}
