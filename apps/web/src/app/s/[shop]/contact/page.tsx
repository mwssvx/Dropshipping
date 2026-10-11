import Link from "next/link";
import { loadShop, storeBase, storeT } from "../data";
import { contactAction } from "../actions";
import { ContactForm } from "./ContactForm";

export const metadata = { title: "Contact us" };

export default async function ContactPage({ params }: { params: Promise<{ shop: string }> }) {
  const { shop: param } = await params;
  const [shop, base, t] = await Promise.all([loadShop(param), storeBase(param), storeT(param)]);
  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t.contactUs}</h1>
        <p className="text-muted">{t.contactIntro}</p>
        <p className="text-sm"><Link href={`${base}/track`} className="underline hover:text-accent">{t.contactTrack}</Link></p>
      </div>
      <section className="card p-5">
        <ContactForm
          action={contactAction.bind(null, param)}
          text={{ name: t.contactName, email: t.contactEmail, order: t.contactOrder, message: t.contactMessage, send: t.contactSend, sending: t.contactSending, sent: t.contactSent }}
        />
      </section>
      {shop.mailingAddress && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className="font-semibold">{t.contactAddress}</h2>
          <p className="text-muted whitespace-pre-line">{shop.invoiceLegalName ? `${shop.invoiceLegalName}\n` : ""}{shop.mailingAddress}</p>
        </section>
      )}
    </main>
  );
}
