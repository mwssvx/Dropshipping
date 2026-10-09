import { getPublishedPageByHandle, NotFoundError, paragraphs } from "@sf/core";
import { db } from "@/lib/server";
import { loadShop, missing } from "../../data";

async function load(param: string, handle: string, count = true) {
  const shop = await loadShop(param);
  try {
    return await getPublishedPageByHandle(await db(), shop.id, handle);
  } catch (e) {
    if (e instanceof NotFoundError) return missing(param, `/pages/${handle}`, count);
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop, handle } = await params;
  const page = await load(shop, handle, false);
  const description = page.seoDescription ?? (page.body.replace(/\s+/g, " ").trim().slice(0, 160) || undefined);
  return { title: page.title, description };
}

export default async function StorePage({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop, handle } = await params;
  const page = await load(shop, handle);
  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <h1 className="text-3xl font-bold tracking-tight">{page.title}</h1>
      <div className="flex flex-col gap-4 leading-relaxed">
        {paragraphs(page.body).map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
      </div>
    </main>
  );
}
