import Link from "next/link";
import { notFound } from "next/navigation";
import { getPage, NotFoundError } from "@sf/core";
import { requireShop, storeAddress } from "@/lib/server";
import { deletePageAction, updatePageAction } from "../../../store-actions";
import { PageHeader } from "../../PageHeader";
import { PageForm } from "../PageForm";

export const metadata = { title: "Page" };

export default async function EditPagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string }> }) {
  const { id } = await params;
  const { shop, db } = await requireShop("pages");
  const page = await getPage(db, shop.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const address = await storeAddress(shop);
  return (
    <main className="pb-12">
      <PageHeader title={page.title} back={<Link href="/admin/pages" className="hint hover:text-ink">← Pages</Link>}
        actions={page.published ? <a href={`${address}/pages/${page.handle}`} target="_blank" className="btn btn-secondary">View ↗</a> : undefined} />
      <div className="px-4 sm:px-8 flex flex-col gap-6">
        <PageForm action={updatePageAction.bind(null, page.id)} submitLabel="Save" saved={(await searchParams).saved === "1"}
          initial={{ title: page.title, handle: page.handle, body: page.body, seoDescription: page.seoDescription ?? "", published: page.published }} />
        <form action={deletePageAction.bind(null, page.id)}>
          <button className="text-sm text-critical hover:underline">Delete this page</button>
          <p className="hint">Remove it from your menus too, or those links will lead nowhere.</p>
        </form>
      </div>
    </main>
  );
}
