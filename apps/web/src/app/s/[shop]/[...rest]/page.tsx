import { missing } from "../data";

/** Any other address on the store: a redirect the merchant set up, or not found. */
export default async function Unknown({ params }: { params: Promise<{ shop: string; rest: string[] }> }) {
  const { shop, rest } = await params;
  return missing(shop, `/${rest.join("/")}`);
}
