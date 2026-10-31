"use client";
import { startTransition, useActionState } from "react";
import { FormError } from "@/components/FormError";
import { adPixelsAction, type PixelState } from "../../pixel-actions";

/** The store's ad tags, and who is asked before they load. */
export function PixelsForm({ meta, tiktok, google, pinterest, consent }: { meta: string; tiktok: string; google: string; pinterest: string; consent: "everyone" | "eu_uk" }) {
  const [state, action, pending] = useActionState(adPixelsAction, {} as PixelState);
  return (
    // Submitted by hand so React doesn't reset the fields after an error.
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
    >
      <FormError message={state.error} />
      {state.saved !== undefined && !pending && !state.error && (
        <p className="banner banner-success" role="status">
          {state.saved ? "Saved. Your store now reports views, carts, checkouts and orders to these tags." : "Saved. No ad tags are loaded on your store."}
        </p>
      )}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="field">
          <label className="label" htmlFor="px-meta">Meta pixel ID</label>
          <input className="input num" id="px-meta" name="meta" inputMode="numeric" autoComplete="off" placeholder="1234567890123456" defaultValue={meta} />
        </div>
        <div className="field">
          <label className="label" htmlFor="px-tiktok">TikTok pixel ID</label>
          <input className="input" id="px-tiktok" name="tiktok" autoComplete="off" placeholder="CABC123DEF456GHI789J" defaultValue={tiktok} />
        </div>
        <div className="field">
          <label className="label" htmlFor="px-google">Google tag ID</label>
          <input className="input" id="px-google" name="google" autoComplete="off" placeholder="G-ABC123DEF4" defaultValue={google} />
        </div>
        <div className="field">
          <label className="label" htmlFor="px-pinterest">Pinterest tag ID</label>
          <input className="input num" id="px-pinterest" name="pinterest" inputMode="numeric" autoComplete="off" placeholder="2612345678901" defaultValue={pinterest} />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Ask before tracking</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="consent" value="everyone" defaultChecked={consent === "everyone"} />
          Every visitor
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="consent" value="eu_uk" defaultChecked={consent === "eu_uk"} />
          Only visitors in the EU, EEA, UK and Switzerland, where the law requires it
        </label>
      </fieldset>
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending}>{pending ? "Saving…" : "Save ad tracking"}</button>
      </div>
    </form>
  );
}
