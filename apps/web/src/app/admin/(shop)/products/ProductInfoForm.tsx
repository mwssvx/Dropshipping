"use client";
import { useActionState } from "react";
import { PRODUCT_INFO_MAX, PRODUCT_INFO_TEXT_MAX, PRODUCT_INFO_TITLE_MAX } from "@sf/core/badges";
import { productInfoAction, type BadgeState } from "../../badge-actions";
import { useFreshKey } from "@/components/useFreshKey";

/** Up to four notes shown under every product, each a title and some text. Empty rows are left out. */
export function ProductInfoForm({ blocks }: { blocks: { title: string; text: string }[] }) {
  const [state, action, pending] = useActionState(productInfoAction, {} as BadgeState);
  const key = useFreshKey(state, "product-info");
  return (
    <form key={key} action={action} className="flex flex-col gap-4">
      {state.saved && !pending && <p className="banner banner-success" role="status">Saved. Every product page shows these notes now.</p>}
      {state.error && <p className="banner banner-critical" role="alert">{state.error}</p>}
      {Array.from({ length: PRODUCT_INFO_MAX }, (_, i) => (
        <fieldset key={i} className="flex flex-col gap-2 border-t border-border pt-3 first-of-type:border-t-0 first-of-type:pt-0">
          <legend className="sr-only">Note {i + 1}</legend>
          <div className="field">
            <label className="label" htmlFor={`info-title-${i}`}>Title {i + 1}</label>
            <input className="input" id={`info-title-${i}`} name={`title${i}`} maxLength={PRODUCT_INFO_TITLE_MAX} defaultValue={blocks[i]?.title ?? ""}
              placeholder={["Shipping", "Returns", "Care", "Warranty"][i]} />
          </div>
          <div className="field">
            <label className="label" htmlFor={`info-text-${i}`}>Text {i + 1}</label>
            <textarea className="input min-h-20" id={`info-text-${i}`} name={`text${i}`} maxLength={PRODUCT_INFO_TEXT_MAX} defaultValue={blocks[i]?.text ?? ""} />
          </div>
        </fieldset>
      ))}
      <div>
        <button type="submit" className="btn btn-secondary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save notes"}</button>
      </div>
    </form>
  );
}
