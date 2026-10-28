"use client";
// The store's floating chat buttons: WhatsApp opens with a first message naming the page the
// shopper is on, so the store knows which product they mean. Hidden where it would cover checkout.
import { usePathname } from "next/navigation";

type Link = { kind: "whatsapp" | "telegram"; href: string };

export function ChatButtons({ links, quiet, text }: { links: Link[]; quiet: string; text: { whatsapp: string; telegram: string; hello: string } }) {
  const path = usePathname();
  if (!links.length || new RegExp(quiet).test(path)) return null;
  return (
    <div className="fixed right-4 bottom-20 sm:bottom-6 z-30 flex flex-col items-end gap-2 print:hidden">
      {links.map((l) => (
        <a
          key={l.kind}
          href={l.href}
          target="_blank"
          rel="noopener noreferrer"
          // The first message names this page, read at the moment of the click.
          onClick={(e) => {
            if (l.kind === "whatsapp") e.currentTarget.href = l.href.replace(/\?text=.*$/, `?text=${encodeURIComponent(`${text.hello} ${location.href}`)}`);
          }}
          className={`rounded-full px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:opacity-90 ${l.kind === "whatsapp" ? "bg-[#1f8f4e]" : "bg-[#1d7fb8]"}`}
        >
          {l.kind === "whatsapp" ? text.whatsapp : text.telegram}
        </a>
      ))}
    </div>
  );
}
