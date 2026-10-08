"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, exact, children }: { href: string; exact?: boolean; children: React.ReactNode }) {
  const path = usePathname();
  const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
      className={`px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}>
      {children}
    </Link>
  );
}
