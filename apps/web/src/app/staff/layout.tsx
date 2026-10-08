import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { requireStaff } from "@/lib/server";

export const metadata = { title: { default: "Staff", template: `%s · ${BRAND} staff` }, robots: { index: false } };

export default async function StaffLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireStaff();
  return (
    <div className="min-h-dvh">
      <header className="bg-surface border-b border-border px-4 sm:px-8 h-14 flex items-center justify-between gap-4">
        <Link href="/staff" className="font-bold tracking-tight">{BRAND} staff</Link>
        <span className="hint truncate">{user.email}</span>
      </header>
      {children}
    </div>
  );
}
