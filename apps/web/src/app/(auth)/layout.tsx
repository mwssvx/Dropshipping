import Link from "next/link";
import { BRAND } from "@/lib/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <Link href="/" className="font-bold text-lg tracking-tight">{BRAND}</Link>
        <div className="card p-6">{children}</div>
      </div>
    </main>
  );
}
