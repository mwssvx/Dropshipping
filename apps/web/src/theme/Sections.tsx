import Link from "next/link";
import { featuredViewAll, pickFeatured, type Section, type SectionSettings, type TrustIcon } from "@sf/core/theme";
import type { StorefrontCatalog } from "@sf/core";
import { cardBadges, type Badge, type BadgeFacts } from "@sf/core/badges";
import type { BadgeSettings } from "@sf/db";
import { storeText, type StoreText } from "@/lib/store-text";
import type { DisplayFx } from "@sf/core/money";
import { Price } from "@/components/Price";
import { UnitPrice } from "@/components/UnitPrice";
import { SubmitButton } from "@/components/SubmitButton";
import { storeHref } from "./style";

/*
 * The section library. Plain components with no server-only code, so the storefront renders
 * them on the server and the editor preview renders the same ones in the browser.
 */

/**
 * fx: the buyer's currency when they picked another one.
 * signup: the email signup form's server action and what happened last time (absent in the editor preview).
 * quickAdd: adds a card's product to the cart; cards have no button when it's left out.
 */
export type SectionData = {
  base: string;
  currency: string;
  fx?: DisplayFx;
  /** Reviews and units sold are left out where no section shows them. */
  catalog: Omit<StorefrontCatalog, "reviews" | "products"> & Partial<Pick<StorefrontCatalog, "reviews">> & { products: CatalogProduct[] };
  signup?: { action: (form: FormData) => Promise<void>; status: "sent" | "invalid" | null; offerPercent?: number | null };
  quickAdd?: (form: FormData) => Promise<void>;
  /** Adds a "Shop the look" section's pieces; the button is greyed out when it's left out. */
  addLook?: (form: FormData) => Promise<void>;
  /** Products this shopper looked at, newest first; the editor preview sends a sample. */
  recentIds?: string[];
  /** The store's fixed words in the buyer's language; English when left out. */
  t?: StoreText;
  /** Which automatic badges product cards show; the defaults when left out. */
  badges?: BadgeSettings;
};

type Props<T extends keyof SectionSettings> = { s: SectionSettings[T]; data: SectionData; first: boolean };

function Paragraphs({ text, className = "" }: { text: string; className?: string }) {
  const parts = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return <>{parts.map((p, i) => <p key={i} className={`whitespace-pre-line ${className}`}>{p}</p>)}</>;
}

function Button({ label, href, base, variant = "primary" }: { label: string; href: string; base: string; variant?: "primary" | "secondary" }) {
  if (!label) return null;
  return <Link href={storeHref(base, href)} className={`btn btn-${variant} btn-lg`}>{label}</Link>;
}

function Announcement({ s, data }: Props<"announcement">) {
  if (!s.text) return null;
  const body = <span>{s.text}</span>;
  return (
    <div className="bg-accent text-accent-ink text-center text-sm font-medium px-4 py-2">
      {s.link ? <Link href={storeHref(data.base, s.link)} className="hover:underline">{body}</Link> : body}
    </div>
  );
}

const HERO_HEIGHT = { small: "min-h-[240px]", medium: "min-h-[380px]", large: "min-h-[540px]" };

function Hero({ s, data, first }: Props<"hero">) {
  const center = s.align === "center";
  return (
    <section className={`relative overflow-hidden flex items-center ${HERO_HEIGHT[s.height]} ${s.imageUrl ? "text-white" : "bg-accent-soft"}`}>
      {s.imageUrl && (
        <>
          <img src={s.imageUrl} alt="" className="absolute inset-0 size-full object-cover" loading={first ? "eager" : "lazy"}
            fetchPriority={first ? "high" : "auto"} decoding="async" />
          <div className="absolute inset-0 bg-black/45" aria-hidden />
        </>
      )}
      <div className={`relative max-w-6xl w-full mx-auto px-4 sm:px-6 py-16 flex flex-col gap-4 ${center ? "items-center text-center" : "items-start"}`}>
        {s.heading && <h2 className="text-4xl sm:text-5xl font-bold tracking-tight max-w-3xl">{s.heading}</h2>}
        {s.text && <p className={`text-lg max-w-2xl ${s.imageUrl ? "text-white/90" : "text-muted"}`}>{s.text}</p>}
        <div className="mt-2"><Button label={s.buttonLabel} href={s.buttonLink} base={data.base} /></div>
      </div>
    </section>
  );
}

/** A badge's words in the buyer's language. */
export function badgeLabel(b: Badge, t: StoreText) {
  return b.kind === "custom" ? b.text : b.kind === "sold_out" ? t.soldOut : b.kind === "sale" ? t.badgeSale(b.percent) : t.badgeNew;
}

type CatalogProduct = Omit<StorefrontCatalog["products"][number], "sold"> & { sold?: number };
type GridProduct = Omit<StorefrontCatalog["products"][number], "badge" | "createdAt" | "soldOut" | "swatches" | "contents" | "quickAdd" | "sold"> & BadgeFacts & Partial<Pick<StorefrontCatalog["products"][number], "swatches" | "contents" | "quickAdd" | "sold">>;

export function ProductGrid({ products, data }: { products: GridProduct[]; data: SectionData }) {
  const t = data.t ?? storeText(null);
  const now = new Date();
  return (
    <ul className="sf-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
      {products.map((p) => {
        const badges = cardBadges(data.badges, p, now);
        return (
        <li key={p.id} className="flex flex-col gap-2">
          <Link href={`${data.base}/products/${p.handle}`} className="sf-card group flex flex-col gap-2 flex-1">
            <div className="sf-media relative aspect-square rounded-lg bg-sunken overflow-hidden">
              {p.imageUrl && (
                <img src={p.imageUrl} alt={p.title} width={600} height={600} loading="lazy" decoding="async"
                  className="size-full object-cover group-hover:scale-[1.02] transition-transform" />
              )}
              {badges.length > 0 && (
                <span className="absolute top-2 left-2 flex flex-col items-start gap-1">
                  {badges.map((b) => (
                    <span key={b.kind} className={`sf-badge rounded-full px-2 py-0.5 text-xs font-semibold shadow-sm ${b.kind === "sold_out" ? "bg-surface text-muted" : b.kind === "sale" ? "bg-critical text-white" : "bg-ink text-surface"}`}>
                      {badgeLabel(b, t)}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <span className="font-medium group-hover:underline">{p.title}</span>
            <Price minor={p.priceMinor} compareAt={p.compareAtMinor} currency={data.currency} fx={data.fx} />
            <UnitPrice minor={p.priceMinor} contents={p.contents} currency={data.currency} fx={data.fx} itemWord={t.unitItem} />
            {p.swatches && (
              <span className="sf-swatches flex items-center gap-1 text-xs text-muted" role="img" aria-label={t.colorCount(p.swatches.count)}>
                {p.swatches.colors.map((c, i) => (
                  <span key={i} className="size-3.5 rounded-full border border-black/20" style={{ background: c }} />
                ))}
                {p.swatches.count > p.swatches.colors.length && <span aria-hidden="true">+{p.swatches.count - p.swatches.colors.length}</span>}
              </span>
            )}
          </Link>
          {data.quickAdd && p.quickAdd && (
            <form action={data.quickAdd}>
              <input type="hidden" name="variantId" value={p.quickAdd} />
              <SubmitButton className="sf-quick-add btn btn-secondary w-full text-sm" pendingText={t.adding}>
                <span aria-hidden="true">{t.addToCart}</span>
                <span className="sr-only">{`${t.addToCart}: ${p.title}`}</span>
              </SubmitButton>
            </form>
          )}
        </li>
        );
      })}
    </ul>
  );
}

function SectionHeading({ text, link, base, viewAll = "View all" }: { text: string; link?: string; base: string; viewAll?: string }) {
  if (!text) return null;
  return (
    <div className="flex items-end justify-between gap-4">
      <h2 className="text-2xl font-bold tracking-tight">{text}</h2>
      {link && <Link href={storeHref(base, link)} className="text-sm font-semibold text-accent hover:underline">{viewAll}</Link>}
    </div>
  );
}

function FeaturedProducts({ s, data }: Props<"featured_products">) {
  const { products, collections } = data.catalog;
  const collection = s.collectionId ? collections.find((c) => c.id === s.collectionId) : null;
  const list = collection
    ? collection.productIds.map((id) => products.find((p) => p.id === id)).filter((p) => !!p)
    : products;
  const show = s.show ?? "listed";
  const shown = pickFeatured(list, show).slice(0, s.limit);
  // A sale grid with nothing on sale is left out, not shown as "coming soon".
  if (!shown.length && show === "on_sale") return null;
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <SectionHeading text={s.heading} base={data.base} link={featuredViewAll(collection?.handle ?? "all", show)} viewAll={(data.t ?? storeText(null)).viewAll} />
      {shown.length ? <ProductGrid products={shown} data={data} /> : <p className="hint">{(data.t ?? storeText(null)).productsComing}</p>}
    </section>
  );
}

function CollectionList({ s, data }: Props<"collection_list">) {
  const all = data.catalog.collections;
  const picked = s.collectionIds.length ? s.collectionIds.map((id) => all.find((c) => c.id === id)).filter((c) => !!c) : all;
  if (!picked.length) return null;
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <SectionHeading text={s.heading} base={data.base} />
      <ul className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {picked.map((c) => {
          const cover = c.imageUrl ?? data.catalog.products.find((p) => p.id === c.productIds[0])?.imageUrl;
          return (
            <li key={c.id}>
              <Link href={`${data.base}/collections/${c.handle}`} className="group relative block aspect-[4/3] rounded-lg overflow-hidden bg-sunken">
                {cover && <img src={cover} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover group-hover:scale-[1.02] transition-transform" />}
                <span className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/60 to-transparent text-white font-semibold">{c.title}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ImageWithText({ s, data }: Props<"image_with_text">) {
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid gap-8 md:grid-cols-2 items-center">
      <div className={`aspect-[4/3] rounded-lg bg-sunken overflow-hidden ${s.imagePosition === "right" ? "md:order-2" : ""}`}>
        {s.imageUrl && <img src={s.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />}
      </div>
      <div className="flex flex-col gap-4 items-start">
        {s.heading && <h2 className="text-3xl font-bold tracking-tight">{s.heading}</h2>}
        <Paragraphs text={s.text} className="text-muted leading-relaxed" />
        <Button label={s.buttonLabel} href={s.buttonLink} base={data.base} variant="secondary" />
      </div>
    </section>
  );
}

function ShopTheLook({ s, data }: Props<"shop_the_look">) {
  const t = data.t ?? storeText(null);
  const pieces = s.productIds.map((id) => data.catalog.products.find((p) => p.id === id)).filter((p) => !!p);
  if (!pieces.length) return null;
  const ready = pieces.flatMap((p) => (p.quickAdd ? [p.quickAdd] : []));
  const heading = s.heading || t.shopLook;
  const label = ready.length === pieces.length ? t.shopLookAddAll : t.shopLookAddSome(ready.length);
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid gap-8 md:grid-cols-2 items-start" aria-label={heading}>
      <div className="aspect-[4/5] rounded-lg bg-sunken overflow-hidden">
        {s.imageUrl && <img src={s.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />}
      </div>
      <div className="flex flex-col gap-5">
        <h2 className="text-3xl font-bold tracking-tight">{heading}</h2>
        {s.text && <Paragraphs text={s.text} className="text-muted leading-relaxed" />}
        <ul className="flex flex-col divide-y divide-border border-y border-border">
          {pieces.map((p) => (
            <li key={p.id}>
              <Link href={`${data.base}/products/${p.handle}`} className="group flex items-center gap-4 py-3">
                <span className="size-16 shrink-0 rounded-md bg-sunken overflow-hidden">
                  {p.imageUrl && <img src={p.imageUrl} alt="" width={64} height={64} loading="lazy" decoding="async" className="size-full object-cover" />}
                </span>
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-medium group-hover:underline truncate">{p.title}</span>
                  {p.soldOut && <span className="text-sm text-muted">{t.soldOut}</span>}
                </span>
                <Price minor={p.priceMinor} compareAt={p.compareAtMinor} currency={data.currency} fx={data.fx} />
              </Link>
            </li>
          ))}
        </ul>
        {ready.length > 0 && (
          <form action={data.addLook} className="flex flex-col gap-2">
            {ready.map((v) => <input key={v} type="hidden" name="variantId" value={v} />)}
            {data.addLook
              ? <SubmitButton className="btn btn-primary btn-lg" pendingText={t.adding}>{label}</SubmitButton>
              : <button type="button" className="btn btn-primary btn-lg" disabled>{label}</button>}
          </form>
        )}
        {ready.length < pieces.filter((p) => !p.soldOut).length && <p className="hint">{t.shopLookChoose}</p>}
      </div>
    </section>
  );
}

function RichText({ s }: Props<"rich_text">) {
  if (!s.heading && !s.text) return null;
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-4 text-center">
      {s.heading && <h2 className="text-3xl font-bold tracking-tight">{s.heading}</h2>}
      <Paragraphs text={s.text} className="text-muted leading-relaxed" />
    </section>
  );
}

function Faq({ s }: Props<"faq">) {
  if (!s.items.length) return null;
  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      {s.heading && <h2 className="text-2xl font-bold tracking-tight">{s.heading}</h2>}
      <div className="flex flex-col border-t border-border">
        {s.items.map((item, i) => (
          <details key={i} className="group border-b border-border">
            <summary className="flex justify-between items-center gap-4 py-4 cursor-pointer font-medium list-none">
              {item.question}
              <span aria-hidden className="text-muted transition-transform group-open:rotate-45 text-xl leading-none">+</span>
            </summary>
            <div className="pb-4 flex flex-col gap-2"><Paragraphs text={item.answer} className="text-muted leading-relaxed" /></div>
          </details>
        ))}
      </div>
    </section>
  );
}

function Testimonials({ s }: Props<"testimonials">) {
  if (!s.items.length) return null;
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      {s.heading && <h2 className="text-2xl font-bold tracking-tight">{s.heading}</h2>}
      <ul className="grid gap-4 md:grid-cols-3">
        {s.items.map((q, i) => (
          <li key={i}>
            <figure className="card h-full p-5 flex flex-col gap-3">
              <blockquote className="leading-relaxed">&ldquo;{q.quote}&rdquo;</blockquote>
              {q.name && <figcaption className="text-sm font-semibold text-muted mt-auto">{q.name}</figcaption>}
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stars({ value, label }: { value: number; label: string }) {
  const full = Math.round(value);
  return (
    <span className="text-warning tracking-tight" role="img" aria-label={label}>
      {"★".repeat(full)}
      <span className="text-border">{"★".repeat(5 - full)}</span>
    </span>
  );
}

/**
 * The store's latest real reviews at or above the merchant's star line. The average counts every
 * published review, not just the ones shown, so it never flatters the store.
 */
function RecentlyViewedSection({ s, data }: Props<"recently_viewed">) {
  const t = data.t ?? storeText(null);
  const shown = (data.recentIds ?? []).map((id) => data.catalog.products.find((p) => p.id === id)).filter((p) => !!p).slice(0, s.limit);
  if (!shown.length) return null;
  return (
    <section className="sf-recent max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <SectionHeading text={s.heading || t.recentlyViewed} base={data.base} />
      <ProductGrid products={shown} data={data} />
    </section>
  );
}

function BuyerReviews({ s, data }: Props<"reviews">) {
  const t = data.t ?? storeText(null);
  const all = data.catalog.reviews;
  const shown = (all?.latest ?? []).filter((r) => r.rating >= s.minRating).slice(0, s.limit);
  if (!all || !shown.length) return null;
  return (
    <section className="sf-reviews max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {s.heading && <h2 className="text-2xl font-bold tracking-tight">{s.heading}</h2>}
        {all.average != null && (
          <p className="text-sm flex items-center gap-2">
            <Stars value={all.average} label={t.stars(all.average)} />
            <span className="font-semibold num" aria-hidden="true">{all.average.toFixed(1)}</span>
            <span className="hint">{t.reviewCount(all.count)}</span>
          </p>
        )}
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {shown.map((r) => (
          <li key={r.id}>
            <figure className="card h-full p-5 flex flex-col gap-3">
              <Stars value={r.rating} label={t.stars(r.rating)} />
              {r.photoUrl && <img src={r.photoUrl} alt="" width={80} height={80} loading="lazy" decoding="async" className="size-20 rounded-md object-cover" />}
              {r.body && <blockquote className="leading-relaxed line-clamp-6 whitespace-pre-line">{r.body}</blockquote>}
              <figcaption className="text-sm mt-auto flex flex-col gap-0.5">
                <span className="font-semibold">
                  {r.name}
                  {r.verified && <span className="hint font-normal"> · {t.verifiedBuyer}</span>}
                </span>
                <Link href={`${data.base}/products/${r.productHandle}`} className="hint hover:underline">{r.productTitle}</Link>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}

const ICONS: Record<TrustIcon, React.ReactNode> = {
  shipping: <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7M7 18a1.5 1.5 0 1 0 0-.01M17 18a1.5 1.5 0 1 0 0-.01" />,
  returns: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  secure: <path d="M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3" />,
  support: <path d="M4 5h16v11H9l-5 4z" />,
  quality: <path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6L12 16.8 6.6 19.6l1.1-6-4.5-4.2 6.1-.8z" />,
  eco: <path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14M5 19l7-7" />,
};

function TrustBadges({ s }: Props<"trust_badges">) {
  if (!s.items.length) return null;
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
      {s.heading && <h2 className="text-2xl font-bold tracking-tight text-center">{s.heading}</h2>}
      <ul className="grid gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        {s.items.map((b, i) => (
          <li key={i} className="flex gap-3 items-start">
            <svg viewBox="0 0 24 24" className="size-7 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {ICONS[b.icon]}
            </svg>
            <div>
              <p className="font-semibold">{b.title}</p>
              {b.text && <p className="text-sm text-muted">{b.text}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LogoList({ s, data }: Props<"logo_list">) {
  const logos = s.items.filter((l) => l.imageUrl);
  if (!logos.length) return null;
  const tone = s.tone === "grey" ? "grayscale opacity-70 hover:grayscale-0 hover:opacity-100 transition" : "";
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6" aria-label={s.heading || undefined}>
      {s.heading && <h2 className="text-sm font-semibold uppercase tracking-wider text-muted text-center">{s.heading}</h2>}
      <ul className="flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
        {logos.map((l, i) => {
          const img = <img src={l.imageUrl} alt={l.name} height={40} loading="lazy" decoding="async" className={`h-10 w-auto max-w-36 object-contain ${tone}`} />;
          return (
            <li key={i}>
              {l.link ? <a href={storeHref(data.base, l.link)} rel={l.link.startsWith("/") ? undefined : "noopener"}>{img}</a> : img}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Newsletter({ s, data }: Props<"newsletter">) {
  const status = data.signup?.status ?? null;
  const t = data.t ?? storeText(null);
  return (
    <section id="signup" className="bg-accent-soft">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-4 items-center text-center">
        {s.heading && <h2 className="text-2xl font-bold tracking-tight">{s.heading}</h2>}
        {s.text && <p className="text-muted">{s.text}</p>}
        {data.signup?.offerPercent && status !== "sent" && <p className="font-medium">{t.welcomeOfferNote(data.signup.offerPercent)}</p>}
        {status && <p role="status" className={`text-sm font-medium ${status === "invalid" ? "text-critical" : ""}`}>{status === "sent" ? t.signupSent : t.signupInvalid}</p>}
        {status !== "sent" && (
          <form action={data.signup?.action} className="flex w-full max-w-md gap-2">
            <label htmlFor="signup-email" className="sr-only">{t.signupEmail}</label>
            <input id="signup-email" name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="input flex-1 min-w-0" />
            <button className="btn btn-primary" disabled={!data.signup}>{s.buttonLabel || t.signUp}</button>
          </form>
        )}
      </div>
    </section>
  );
}

export function SectionView({ section, data, first }: { section: Section; data: SectionData; first: boolean }) {
  switch (section.type) {
    case "announcement": return <Announcement s={section.settings} data={data} first={first} />;
    case "hero": return <Hero s={section.settings} data={data} first={first} />;
    case "featured_products": return <FeaturedProducts s={section.settings} data={data} first={first} />;
    case "collection_list": return <CollectionList s={section.settings} data={data} first={first} />;
    case "image_with_text": return <ImageWithText s={section.settings} data={data} first={first} />;
    case "rich_text": return <RichText s={section.settings} data={data} first={first} />;
    case "faq": return <Faq s={section.settings} data={data} first={first} />;
    case "testimonials": return <Testimonials s={section.settings} data={data} first={first} />;
    case "trust_badges": return <TrustBadges s={section.settings} data={data} first={first} />;
    case "newsletter": return <Newsletter s={section.settings} data={data} first={first} />;
    case "reviews": return <BuyerReviews s={section.settings} data={data} first={first} />;
    case "recently_viewed": return <RecentlyViewedSection s={section.settings} data={data} first={first} />;
    case "shop_the_look": return <ShopTheLook s={section.settings} data={data} first={first} />;
    case "logo_list": return <LogoList s={section.settings} data={data} first={first} />;
  }
}

/** The home page: visible sections in order. `highlight` outlines one section in the editor preview. */
export function HomeSections({ sections, data, highlight }: { sections: Section[]; data: SectionData; highlight?: string | null }) {
  const visible = sections.filter((s) => !s.hidden && s.type !== "announcement");
  return (
    <>
      {visible.map((s, i) => (
        <div key={s.id} data-section={s.id} className={highlight === s.id ? "outline-2 outline-dashed outline-accent -outline-offset-2" : undefined}>
          <SectionView section={s} data={data} first={i === 0} />
        </div>
      ))}
    </>
  );
}
