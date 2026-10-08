import { notFound } from "next/navigation";
import { BRAND } from "@/lib/brand";
import { LEGAL_DOCS } from "../docs";

export function generateStaticParams() {
  return LEGAL_DOCS.map((d) => ({ doc: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }) {
  const { doc: slug } = await params;
  const doc = LEGAL_DOCS.find((d) => d.slug === slug);
  return doc ? { title: doc.title, description: doc.summary } : {};
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc: slug } = await params;
  const doc = LEGAL_DOCS.find((d) => d.slug === slug);
  if (!doc) notFound();
  return (
    <main className="px-4 sm:px-8 pb-12 max-w-3xl mx-auto flex flex-col gap-6">
      <p className="banner banner-warning" role="note">Draft for review. This page hasn&apos;t been checked by a lawyer yet and isn&apos;t in force.</p>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{doc.title}</h1>
        <p className="text-muted">{doc.summary}</p>
      </div>
      {doc.sections.map((s) => (
        <section key={s.heading} className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{s.heading}</h2>
          {s.body.map((p, i) => <p key={i} className="leading-relaxed">{p.replaceAll("the platform", BRAND).replaceAll("The platform", BRAND)}</p>)}
        </section>
      ))}
    </main>
  );
}
