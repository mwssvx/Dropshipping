"use client";
import { useEffect } from "react";
import { pixelEvent, type PixelEventData, type PixelEventName } from "./AdPixels";

/** Tells the store's ad tags about this page: a product viewed, checkout started, an order paid. */
export function PixelEvent({ name, data }: { name: PixelEventName; data: PixelEventData }) {
  const key = JSON.stringify(data);
  useEffect(() => pixelEvent(name, JSON.parse(key) as PixelEventData), [name, key]);
  return null;
}
