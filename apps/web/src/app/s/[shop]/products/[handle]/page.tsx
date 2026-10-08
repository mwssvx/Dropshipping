import { notFound } from "next/navigation";
import { getActiveProductByHandle, NotFoundError } from "@sf/core";
import { db } from "@/lib/server";
import { SubmitButton } from "@/components/SubmitButton";
import { addToCartAction } from "../../actions";
import { loadShop } from "../../data";
import { Price } from "@/components/Price";

async function load(shopHandle: string, handle: string) {
  const shop = await loadShop(shopHandle);
  try {
    return { shop, product: await getActiveProductByHandle(await db(), shop.id, handle) };
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop, handle } = await params;
  return { title: (await load(shop, handle)).product.title };
}

export default async function ProductPage({ params }: { params: Promise<{ shop: string; handle: string }> }) {
  const { shop: shopHandle, handle } = await params;
  const { shop, product } = await load(shopHandle, handle);
  const v = product.variants[0];
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid gap-10 md:grid-cols-2">
      <div className="aspect-square rounded-xl bg-sunken overflow-hidden">
        {product.imageUrl && <img src={product.imageUrl} alt={product.title} className="size-full object-cover" />}
      </div>
      <div className="flex flex-col gap-5">
        <h1 className="text-3xl font-bold tracking-tight">{product.title}</h1>
        {v && <div className="text-xl"><Price minor={v.priceMinor} compareAt={v.compareAtMinor} currency={shop.currency} /></div>}
        {v && (
          <form action={addToCartAction.bind(null, shopHandle)} className="flex flex-col gap-3">
            <input type="hidden" name="variantId" value={v.id} />
            <input type="hidden" name="quantity" value="1" />
            <SubmitButton className="btn btn-primary btn-lg" pendingText="Adding…">Add to cart</SubmitButton>
          </form>
        )}
        {v?.shipDaysMin != null && v.shipDaysMax != null && (
          <p className="text-sm">Arrives in {v.shipDaysMin}–{v.shipDaysMax} days</p>
        )}
        {product.descriptionHtml && <div className="text-muted whitespace-pre-line leading-relaxed">{product.descriptionHtml}</div>}
        <ul className="hint flex flex-col gap-1 border-t border-border pt-4">
          <li>Secure checkout. Card details never touch this store.</li>
          <li>Questions about your order? Reply to your confirmation email.</li>
        </ul>
      </div>
    </main>
  );
}
