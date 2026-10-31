import { socialLinks, type SocialNetwork, type ThemeDoc } from "@sf/core/theme";

const ICONS: Record<SocialNetwork, React.ReactNode> = {
  instagram: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r=".6" fill="currentColor" />
    </g>
  ),
  facebook: <path d="M13.5 21v-7.5H16l.4-3h-2.9V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21z" />,
  tiktok: <path d="M16.6 3c.3 2.3 1.6 3.7 3.9 3.9v3c-1.4.1-2.7-.3-3.9-1.1v5.5a5.9 5.9 0 1 1-5.9-5.9h.6v3.1a2.9 2.9 0 1 0 2.2 2.8V3z" />,
  youtube: (
    <path fillRule="evenodd" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8c.4-1.6.4-4.8.4-4.8s0-3.2-.4-4.8zM10 15.1V8.9l5.3 3.1z" />
  ),
  pinterest: (
    <path d="M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.5 1.8-2.5.9 0 1.3.7 1.3 1.5 0 .9-.6 2.2-.9 3.4-.2 1 .5 1.9 1.5 1.9 1.9 0 3.3-2 3.3-4.9 0-2.6-1.8-4.4-4.5-4.4-3 0-4.8 2.3-4.8 4.6 0 .9.4 1.9.8 2.4l.1.4-.3 1.1c0 .2-.2.3-.4.2-1.3-.6-2.1-2.5-2.1-4 0-3.3 2.4-6.3 6.9-6.3 3.6 0 6.4 2.6 6.4 6 0 3.6-2.3 6.5-5.4 6.5-1.1 0-2.1-.6-2.4-1.2l-.7 2.5c-.2.9-.9 2.1-1.3 2.8A10 10 0 1 0 12 2z" />
  ),
  x: <path d="M3.5 3.5h5.2l4 5.6 4.8-5.6h2l-5.9 6.9 7 10.1h-5.2l-4.4-6.2-5.4 6.2h-2l6.5-7.4zm2.9 1.4l9.8 14.2h1.4L7.8 4.9z" />,
};

/** The store's social pages as a row of icons, each opening in a new tab. Nothing when there are none. */
export function SocialIcons({ social, label, followOn }: { social: ThemeDoc["settings"]["social"]; label: string; followOn: (site: string) => string }) {
  const links = socialLinks(social);
  if (!links.length) return null;
  return (
    <ul aria-label={label} className="sf-social flex flex-wrap items-center gap-1 -ml-2">
      {links.map((l) => (
        <li key={l.network}>
          <a href={l.href} target="_blank" rel="noopener noreferrer me" aria-label={followOn(l.label)} title={l.label}
            className="inline-flex size-10 items-center justify-center rounded-full hover:text-accent hover:bg-sunken focus-visible:outline-2 focus-visible:outline-accent">
            <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>{ICONS[l.network]}</svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
