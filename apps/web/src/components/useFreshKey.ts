"use client";
import { useState } from "react";

/**
 * A key that changes once each time a form's action saves, so `<form key={…}>` starts empty after
 * every save but keeps what was typed on any other render (a pending submit, an error).
 */
export function useFreshKey(state: { saved?: boolean }, base: string) {
  const [seen, setSeen] = useState({ state, saves: 0 });
  // Each action result is a new object; count it once, while rendering, as React recommends for
  // values that follow a prop.
  if (seen.state !== state) setSeen({ state, saves: seen.saves + (state.saved ? 1 : 0) });
  return `${base}-${seen.state !== state && state.saved ? seen.saves + 1 : seen.saves}`;
}
