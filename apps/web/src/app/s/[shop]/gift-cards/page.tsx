import Link from "next/link";
import { loadShop, storeBase, storeT } from "../data";
import { BalanceForm } from "./BalanceForm";

export const metadata = { title: "Gift card balance", robots: { index: false } };

/** Anyone with a gift card code can see what's left on it, without starting a cart. */
export default async function GiftCardBalancePage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: handle } = await params;
  await loadShop(handle);
  const [base, t] = await Promise.all([storeBase(handle), storeT(handle)]);
  return (
    <main className="max-w-lg mx-auto px-4 sm:px-6 py-12 flex flex-col gap-5">
      <h1 className="text-3xl font-bold tracking-tight">{t.giftCardBalance}</h1>
      <p className="text-muted">{t.giftCardBalanceIntro}</p>
      <BalanceForm handle={handle} text={{ code: t.giftCardCode, check: t.checkBalance, checking: t.checking, giftCard: t.giftCard }} />
      <Link href={`${base}/cart`} className="underline text-sm self-start">{t.giftCardUseIt}</Link>
    </main>
  );
}
