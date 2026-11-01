import { useApi } from "../../src/api";
import { BackLink, Body, Card, EmptyState, List, LoadError, Loading, Row, Screen, Section } from "../../src/ui";

type Data = {
  checked: number;
  fine: number;
  products: { id: string; title: string; listing: { title: string; description: string }; issues: string[] }[];
  undescribed: { id: string; title: string; photos: number }[];
  undescribedTotal: number;
};

/** How products on sale look in search results, and what's holding each one back. */
export default function SearchListingsScreen() {
  const data = useApi<Data>("search-listings");
  const d = data.data;
  return (
    <Screen title="Search listings" back={<BackLink href="/products" label="Products" />} onRefresh={data.reload} refreshing={data.loading && !!d}>
      <LoadError error={data.error} stale={data.stale} retry={data.reload} />
      {!d ? (
        data.loading ? <Loading /> : null
      ) : (
        <>
          <Body muted>How your products on sale look in Google and other search results. Supplier titles are often long and full of filler like "hot sale", which looks spammy and gets fewer clicks.</Body>
          {d.checked === 0 ? (
            <EmptyState heading="No products on sale yet" body="Listings are checked once products are on sale." />
          ) : d.products.length === 0 ? (
            <EmptyState heading="Every listing looks clean" body={`All ${d.checked} products on sale have a clean listing.`} />
          ) : (
            <Section title={`${d.products.length === 1 ? "1 product needs" : `${d.products.length} products need`} a look`}>
              <Body muted>{`${d.fine} of ${d.checked} are fine.`}</Body>
              <List>
                {d.products.map((p) => (
                  <Row
                    key={p.id}
                    href={`/search-listings/${p.id}`}
                    title={p.listing.title}
                    subtitle={p.issues.join(" · ")}
                    a11y={`Fix ${p.title}: ${p.issues.join(", ")}`}
                  />
                ))}
              </List>
            </Section>
          )}
          {d.undescribed.length ? (
            <Section title="Photos with no description">
              <Card>
                <Body muted>A sentence about what each photo shows helps your products turn up in image search, and buyers who use a screen reader hear it instead of just the product's name. Add them on the web.</Body>
              </Card>
              <List>
                {d.undescribed.map((p) => (
                  <Row key={p.id} title={p.title} subtitle={p.photos === 1 ? "1 photo" : `${p.photos} photos`} />
                ))}
              </List>
              {d.undescribedTotal > d.undescribed.length ? <Body muted>{`And ${d.undescribedTotal - d.undescribed.length} more.`}</Body> : null}
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}
