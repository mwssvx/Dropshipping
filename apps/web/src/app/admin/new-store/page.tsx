import { requireUser } from "@/lib/server";
import { BRAND } from "@/lib/brand";
import { NewStoreForm } from "./NewStoreForm";

export const metadata = { title: "Name your store" };

export default async function NewStorePage() {
  await requireUser();
  return (
    <main className="min-h-dvh grid place-items-center px-4 py-12">
      <div className="w-full max-w-md flex flex-col gap-6">
        <span className="font-bold text-lg tracking-tight">{BRAND}</span>
        <div className="card p-6 flex flex-col gap-5">
          <div>
            <h1 className="text-xl font-bold">Name your store</h1>
            <p className="hint mt-1">You can change the name later. Your store gets a free web address straight away.</p>
          </div>
          <NewStoreForm />
        </div>
      </div>
    </main>
  );
}
