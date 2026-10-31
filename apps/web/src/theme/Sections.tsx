import Link from "next/link";
import { Fragment } from "react";
import { announcementMessages, collectionTabs, directionsUrl, featuredViewAll, pickFeatured, type Section, type SectionSettings, type TrustIcon } from "@sf/core/theme";
import type { PostCard, StorefrontCatalog } from "@sf/core";
import { cardBadges, type Badge, type BadgeFacts } from "@sf/core/badges";
import type { BadgeSettings } from "@sf/db";
import { storeText, type StoreText } from "@/lib/store-text";
import type { DisplayFx } from "@sf/core/money";
import { Price } from "@/components/Price";
import { UnitPrice } from "@/components/UnitPrice";
import { SubmitButton } from "@/components/SubmitButton";
import { parseVideo } from "@sf/core/video-link";
import { SectionVideo } from "./SectionVideo";
import { AnnouncementBar } from "./AnnouncementBar";
import { Slideshow } from "./Slideshow";
import { Countdown } from "./Countdown";
import { ScrollingText } from "./ScrollingText";
import { BeforeAfter } from "./BeforeAfter";
import { CollectionTabs } from "./CollectionTabs";
import { ContactForm } from "@/app/s/[shop]/contact/ContactForm";
import type { ContactState } from "@/app/s/[shop]/actions";
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
  /** The newest blog posts, loaded only where a section shows them. */
  posts?: PostCard[];
  /** The shopper's language, for dates; American English when left out. */
  lang?: string;
  /** Sends a "Contact form" section's message; the button is greyed out when it's left out. */
  contact?: (state: ContactState, form: FormData) => Promise<ContactState>;
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
  const messages = announcementMessages(s);
  if (!messages.length) return null;
  if (messages.length > 1) {
    const t = data.t ?? storeText(null);
    return (
      <AnnouncementBar messages={messages.map((m) => ({ text: m.text, href: m.link ? storeHref(data.base, m.link) : "" }))} seconds={s.seconds ?? 5}
        labels={{ previous: t.announcementPrevious, next: t.announcementNext, pause: t.announcementPause, play: t.announcementPlay }} />
    );
  }
  const m = messages[0]!;
  const body = <span>{m.text}</span>;
  return (
    <div className="bg-accent text-accent-ink text-center text-sm font-medium px-4 py-2">
      {m.link ? <Link href={storeHref(data.base, m.link)} className="hover:underline">{body}</Link> : body}
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

function SlideshowSection({ s, data, first }: Props<"slideshow">) {
  const t = data.t ?? storeText(null);
  const slides = s.slides.filter((x) => x.imageUrl || x.heading);
  if (!slides.length) return null;
  return (
    <Slideshow slides={slides.map((x) => ({ imageUrl: x.imageUrl, heading: x.heading, text: x.text, buttonLabel: x.buttonLabel, href: storeHref(data.base, x.buttonLink) }))}
      seconds={s.seconds} height={HERO_HEIGHT[s.height]} center={s.align === "center"} first={first}
      labels={{ slideshow: t.slideshow, previous: t.slidePrevious, next: t.slideNext, pause: t.slidePause, play: t.slidePlay, of: t.slideOf, goTo: t.slideGoTo }} />
  );
}

/** A badge's words in the buyer's language. */
export function badgeLabel(b: Badge, t: StoreText) {
  return b.kind === "custom" ? b.text : b.kind === "sold_out" ? t.soldOut : b.kind === "sale" ? t.badgeSale(b.percent) : t.badgeNew;
}

type CatalogProduct = Omit<StorefrontCatalog["products"][number], "sold" | "rating"> & Partial<Pick<StorefrontCatalog["products"][number], "sold" | "rating">>;
type GridProduct = Omit<StorefrontCatalog["products"][number], "badge" | "createdAt" | "soldOut" | "swatches" | "contents" | "quickAdd" | "quickPick" | "sold" | "hoverImageUrl" | "rating"> & BadgeFacts & Partial<Pick<StorefrontCatalog["products"][number], "swatches" | "contents" | "quickAdd" | "quickPick" | "sold" | "hoverImageUrl" | "rating">>;

/** Numbered grids give each card an id (item-1, item-2...), so "Show more" can land on the first new one. */
export function ProductGrid({ products, data, numbered = false }: { products: GridProduct[]; data: SectionData; numbered?: boolean }) {
  const t = data.t ?? storeText(null);
  const now = new Date();
  return (
    <ul className="sf-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
      {products.map((p, i) => {
        const badges = cardBadges(data.badges, p, now);
        return (
        <li key={p.id} id={numbered ? `item-${i + 1}` : undefined} className="flex flex-col gap-2 scroll-mt-[calc(var(--sticky-offset,0px)+1rem)]">
          <Link href={`${data.base}/products/${p.handle}`} className="sf-card group flex flex-col gap-2 flex-1">
            <div className="sf-media relative aspect-square rounded-lg bg-sunken overflow-hidden">
              {p.imageUrl && (
                <img src={p.imageUrl} alt={p.title} width={600} height={600} loading="lazy" decoding="async"
                  className="size-full object-cover group-hover:scale-[1.02] transition-transform" />
              )}
              {p.imageUrl && p.hoverImageUrl && <img src={p.hoverImageUrl} alt="" width={600} height={600} loading="lazy" decoding="async" className="sf-hover-photo absolute inset-0 size-full object-cover" />}
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
            {p.rating && (
              <span className="sf-card-rating flex items-center gap-1 text-sm">
                <Stars value={p.rating.average} label={t.stars(p.rating.average)} />
                <span className="text-muted" aria-hidden="true">({p.rating.count})</span>
                <span className="sr-only">{t.reviewCount(p.rating.count)}</span>
              </span>
            )}
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
          {data.quickAdd && !p.quickAdd && p.quickPick && (
            // A few options at one price: pick one right on the card. Sold out ones show but can't be picked.
            <form action={data.quickAdd} className="sf-quick-pick flex gap-2">
              <label className="flex-1 min-w-0">
                <span className="sr-only">{t.pickOption(p.title)}</span>
                <select name="variantId" className="input w-full h-9 py-0 text-sm" defaultValue={p.quickPick.find((o) => !o.soldOut)!.id}>
                  {p.quickPick.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.soldOut}>{o.soldOut ? `${o.title} (${t.soldOut})` : o.title}</option>
                  ))}
                </select>
              </label>
              <SubmitButton className="sf-quick-add btn btn-secondary h-9 shrink-0 text-sm" pendingText={t.adding}>
                <span aria-hidden="true">{t.add}</span>
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

/**
 * One product up close. Add to cart works when there's nothing to pick; a product with options or
 * personal touches sends the shopper to its own page to choose.
 */
function FeaturedProduct({ s, data, first }: Props<"featured_product">) {
  const t = data.t ?? storeText(null);
  const p = s.productId ? data.catalog.products.find((x) => x.id === s.productId) : undefined;
  if (!p) return null;
  const href = `${data.base}/products/${p.handle}`;
  return (
    <section className="sf-featured-product max-w-6xl mx-auto px-4 sm:px-6 py-12 grid gap-8 md:grid-cols-2 items-center" aria-label={p.title}>
      <Link href={href} className={`aspect-square rounded-lg bg-sunken overflow-hidden ${s.imagePosition === "right" ? "md:order-2" : ""}`} tabIndex={-1} aria-hidden="true">
        {p.imageUrl && (
          <img src={p.imageUrl} alt="" width={900} height={900} loading={first ? "eager" : "lazy"} fetchPriority={first ? "high" : "auto"} decoding="async"
            className="size-full object-cover" />
        )}
      </Link>
      <div className="flex flex-col gap-4 items-start">
        <h2 className="text-3xl font-bold tracking-tight"><Link href={href} className="hover:underline">{p.title}</Link></h2>
        {p.rating && (
          <span className="flex items-center gap-1">
            <Stars value={p.rating.average} label={t.stars(p.rating.average)} />
            <span className="text-muted text-sm">{t.reviewCount(p.rating.count)}</span>
          </span>
        )}
        <span className="text-xl">
          <Price minor={p.priceMinor} compareAt={p.compareAtMinor} currency={data.currency} fx={data.fx} />
        </span>
        <UnitPrice minor={p.priceMinor} contents={p.contents} currency={data.currency} fx={data.fx} itemWord={t.unitItem} />
        {s.text && <Paragraphs text={s.text} className="text-muted leading-relaxed" />}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {p.soldOut ? (
            <button type="button" className="btn btn-primary btn-lg" disabled>{t.soldOut}</button>
          ) : p.quickAdd ? (
            <form action={data.addLook}>
              <input type="hidden" name="variantId" value={p.quickAdd} />
              {data.addLook
                ? <SubmitButton className="btn btn-primary btn-lg" pendingText={t.adding}>{t.addToCart}</SubmitButton>
                : <button type="button" className="btn btn-primary btn-lg" disabled>{t.addToCart}</button>}
            </form>
          ) : (
            <Link href={href} className="btn btn-primary btn-lg">{t.featuredChoose}</Link>
          )}
          <Link href={href} className="text-sm font-semibold text-accent hover:underline">{t.featuredDetails}</Link>
        </div>
      </div>
    </section>
  );
}

function CountdownSection({ s, data }: Props<"countdown">) {
  const t = data.t ?? storeText(null);
  if (!s.endsAt || new Date(s.endsAt).getTime() <= Date.now()) return null;
  return (
    <Countdown endsAt={s.endsAt} heading={s.heading} text={s.text}
      button={s.buttonLabel ? { label: s.buttonLabel, href: storeHref(data.base, s.buttonLink) } : null}
      labels={{ days: t.countdownDays, hours: t.countdownHours, minutes: t.countdownMinutes, seconds: t.countdownSeconds }} />
  );
}

function BlogPosts({ s, data }: Props<"blog_posts">) {
  const t = data.t ?? storeText(null);
  const posts = (data.posts ?? []).slice(0, s.limit);
  if (!posts.length) return null;
  const heading = s.heading || t.blogHeading;
  const date = new Intl.DateTimeFormat(data.lang ?? "en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6" aria-label={heading}>
      <SectionHeading text={heading} base={data.base} link="/blog" viewAll={t.viewAll} />
      <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((p) => (
          <li key={p.id}>
            <article className="flex flex-col gap-2">
              {p.imageUrl && (
                <Link href={`${data.base}/blog/${p.handle}`} className="sf-media block aspect-[3/2] rounded-lg bg-sunken overflow-hidden" tabIndex={-1} aria-hidden="true">
                  <img src={p.imageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
                </Link>
              )}
              <h3 className="text-lg font-semibold"><Link href={`${data.base}/blog/${p.handle}`} className="hover:underline">{p.title}</Link></h3>
              <p className="hint">{p.publishedAt ? `${date.format(new Date(p.publishedAt))} · ` : ""}{t.readMinutes(p.minutes)}</p>
              {p.summary && <p className="text-muted line-clamp-3">{p.summary}</p>}
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ScrollingTextSection({ s, data }: Props<"scrolling_text">) {
  const t = data.t ?? storeText(null);
  const items = s.items.map((i) => i.text.trim()).filter(Boolean);
  if (!items.length) return null;
  return <ScrollingText items={items} speed={s.speed} large={s.size === "large"} labels={{ region: t.marquee, pause: t.marqueePause, play: t.marqueePlay }} />;
}

// Two photos across on phones; wide screens fit four, or three when that fills the rows evenly.
const GALLERY_GRID: Record<number, string> = { 1: "max-w-md mx-auto", 2: "grid-cols-2 max-w-3xl mx-auto", 3: "grid-cols-2 md:grid-cols-3", 6: "grid-cols-2 md:grid-cols-3", 9: "grid-cols-2 md:grid-cols-3" };

function Gallery({ s, data }: Props<"gallery">) {
  const t = data.t ?? storeText(null);
  const photos = s.items.filter((p) => p.imageUrl);
  if (!photos.length) return null;
  return (
    <section className="sf-gallery max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6" aria-label={s.heading || undefined}>
      {(s.heading || s.text) && (
        <div className="flex flex-col gap-2 text-center">
          {s.heading && <h2 className="text-3xl font-bold tracking-tight">{s.heading}</h2>}
          {s.text && <p className="text-muted leading-relaxed whitespace-pre-line">{s.text}</p>}
        </div>
      )}
      <ul className={`grid gap-2 sm:gap-3 ${GALLERY_GRID[photos.length] ?? "grid-cols-2 md:grid-cols-4"}`}>
        {photos.map((p, i) => {
          const img = <img src={p.imageUrl} alt={p.link ? "" : p.alt} width={600} height={600} loading="lazy" decoding="async" className="size-full object-cover group-hover:scale-[1.03] transition-transform" />;
          return (
            <li key={i} className="group aspect-square rounded-lg bg-sunken overflow-hidden">
              {p.link ? (
                <a href={storeHref(data.base, p.link)} rel={p.link.startsWith("/") ? undefined : "noopener"} aria-label={p.alt || t.galleryPhoto(i + 1)} className="block size-full">{img}</a>
              ) : img}
            </li>
          );
        })}
      </ul>
      {s.buttonLabel && (
        <div className="flex justify-center">
          <a href={storeHref(data.base, s.buttonLink)} rel={s.buttonLink.startsWith("/") ? undefined : "noopener"} className="btn btn-secondary btn-lg">{s.buttonLabel}</a>
        </div>
      )}
    </section>
  );
}

function BeforeAfterSection({ s, data }: Props<"before_after">) {
  const t = data.t ?? storeText(null);
  if (!s.beforeUrl || !s.afterUrl) return null;
  return (
    <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6" aria-label={s.heading || undefined}>
      {(s.heading || s.text) && (
        <div className="flex flex-col gap-2 text-center">
          {s.heading && <h2 className="text-3xl font-bold tracking-tight">{s.heading}</h2>}
          {s.text && <p className="text-muted leading-relaxed whitespace-pre-line">{s.text}</p>}
        </div>
      )}
      <BeforeAfter beforeUrl={s.beforeUrl} afterUrl={s.afterUrl} before={s.beforeLabel || t.before} after={s.afterLabel || t.after} slider={t.compareSlider} />
    </section>
  );
}

function CollectionTabsSection({ s, data }: Props<"collection_tabs">) {
  const t = data.t ?? storeText(null);
  const { products, collections } = data.catalog;
  const tabs = collectionTabs(s.collectionIds, collections, (id) => products.some((p) => p.id === id));
  if (!tabs.length) return null;
  const grids = tabs.map((c) => {
    const shown = c.productIds.map((id) => products.find((p) => p.id === id)).filter((p) => !!p).slice(0, s.limit);
    return (
      <Fragment key={c.id}>
        <ProductGrid products={shown} data={data} />
        <Link href={`${data.base}/collections/${c.handle}`} className="btn btn-secondary self-center">{t.shopCollection(c.title)}</Link>
      </Fragment>
    );
  });
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6" aria-label={s.heading || undefined}>
      <SectionHeading text={s.heading} base={data.base} />
      {/* One collection needs no tabs. */}
      {tabs.length === 1 ? grids[0] : <CollectionTabs tabs={tabs.map((c) => c.title)} label={s.heading || t.collectionTabs}>{grids}</CollectionTabs>}
    </section>
  );
}

function VisitUs({ s, data, first }: Props<"store_location">) {
  const t = data.t ?? storeText(null);
  if (!s.address) return null;
  const heading = s.heading || t.visitUs;
  const hours = s.hours.filter((h) => h.days);
  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-12" aria-label={heading}>
      <div className={`grid gap-8 items-center ${s.imageUrl ? "md:grid-cols-2" : "max-w-2xl"}`}>
        <div className="flex flex-col gap-5">
          <h2 className="text-3xl font-bold tracking-tight">{heading}</h2>
          <address className="not-italic text-lg leading-relaxed whitespace-pre-line">{s.address}</address>
          {hours.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="font-semibold">{t.openingHours}</h3>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
                {hours.map((h, i) => (
                  <Fragment key={i}>
                    <dt className="font-medium">{h.days}</dt>
                    <dd className="text-muted">{h.time}</dd>
                  </Fragment>
                ))}
              </dl>
            </div>
          )}
          {s.text && <p className="text-muted leading-relaxed whitespace-pre-line">{s.text}</p>}
          <a href={directionsUrl(s.address)} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg self-start">
            {t.directions}<span className="sr-only"> {t.opensNewTab}</span>
          </a>
        </div>
        {s.imageUrl && (
          <img src={s.imageUrl} alt="" className="w-full aspect-[4/3] object-cover rounded-lg" loading={first ? "eager" : "lazy"} decoding="async" />
        )}
      </div>
    </section>
  );
}

function ContactSection({ s, data }: Props<"contact_form">) {
  const t = data.t ?? storeText(null);
  const heading = s.heading || t.contactUs;
  return (
    <section className="max-w-2xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-6" aria-label={heading}>
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-3xl font-bold tracking-tight">{heading}</h2>
        <p className="text-muted leading-relaxed whitespace-pre-line">{s.text || t.contactIntro}</p>
      </div>
      <div className="card p-5">
        <ContactForm action={data.contact}
          text={{ name: t.contactName, email: t.contactEmail, order: t.contactOrder, message: t.contactMessage, send: t.contactSend, sending: t.contactSending, sent: t.contactSent }} />
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

// Two columns sit side by side from small screens, three or more need the room of a wide one.
const COLUMN_GRID: Record<number, string> = {
  1: "max-w-xl mx-auto",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
  5: "sm:grid-cols-2 lg:grid-cols-3",
  6: "sm:grid-cols-2 lg:grid-cols-3",
};

function Columns({ s, data }: Props<"columns">) {
  const columns = s.items.filter((c) => c.imageUrl || c.title || c.text);
  if (!columns.length) return null;
  const center = s.align === "center";
  return (
    <section className="sf-columns max-w-6xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-8" aria-label={s.heading || undefined}>
      {s.heading && <h2 className="text-3xl font-bold tracking-tight text-center">{s.heading}</h2>}
      <ul className={`grid gap-8 grid-cols-1 ${COLUMN_GRID[columns.length]}`}>
        {columns.map((c, i) => (
          <li key={i} className={`flex flex-col gap-3 ${center ? "items-center text-center" : ""}`}>
            {c.imageUrl && <img src={c.imageUrl} alt="" loading="lazy" decoding="async" className="sf-media w-full aspect-[4/3] object-cover rounded-lg" />}
            {c.title && <h3 className="text-lg font-semibold">{c.title}</h3>}
            {c.text && <Paragraphs text={c.text} className="text-muted leading-relaxed" />}
            {c.link && c.linkLabel && (
              <a href={storeHref(data.base, c.link)} rel={c.link.startsWith("/") ? undefined : "noopener"} className="font-medium underline underline-offset-4">
                {c.linkLabel}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function VideoBlock({ s, data }: Props<"video">) {
  const t = data.t ?? storeText(null);
  const video = parseVideo(s.videoUrl);
  if (!video) return null;
  const title = s.heading || t.productVideo;
  return (
    <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 flex flex-col gap-5" aria-label={title}>
      {(s.heading || s.text) && (
        <div className="flex flex-col gap-2 text-center">
          {s.heading && <h2 className="text-3xl font-bold tracking-tight">{s.heading}</h2>}
          {s.text && <Paragraphs text={s.text} className="text-muted leading-relaxed" />}
        </div>
      )}
      <div className="sf-media aspect-video rounded-xl bg-ink overflow-hidden">
        <SectionVideo key={s.videoUrl} video={video} cover={s.coverUrl} title={title} play={t.playVideo} />
      </div>
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
    case "video": return <VideoBlock s={section.settings} data={data} first={first} />;
    case "slideshow": return <SlideshowSection s={section.settings} data={data} first={first} />;
    case "columns": return <Columns s={section.settings} data={data} first={first} />;
    case "featured_product": return <FeaturedProduct s={section.settings} data={data} first={first} />;
    case "countdown": return <CountdownSection s={section.settings} data={data} first={first} />;
    case "blog_posts": return <BlogPosts s={section.settings} data={data} first={first} />;
    case "scrolling_text": return <ScrollingTextSection s={section.settings} data={data} first={first} />;
    case "gallery": return <Gallery s={section.settings} data={data} first={first} />;
    case "before_after": return <BeforeAfterSection s={section.settings} data={data} first={first} />;
    case "collection_tabs": return <CollectionTabsSection s={section.settings} data={data} first={first} />;
    case "store_location": return <VisitUs s={section.settings} data={data} first={first} />;
    case "contact_form": return <ContactSection s={section.settings} data={data} first={first} />;
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
