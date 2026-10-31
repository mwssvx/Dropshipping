import { expect, test } from "@playwright/test";

// Stars in Google Shopping: Sales channels gives the product review feed link, and the feed lists
// the store's published reviews as well-formed XML.

test("the merchant finds the Google product review feed", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`rfeed-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Stars ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Stars/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;
  const handle = product.split("/products/")[1]!;

  const csv = [
    "product_handle,state,rating,title,author,email,location,body,reply,created_at,replied_at",
    `${handle},published,5,,Ada & Co,a@example.com,,Lovely <warm> light.,,2025-03-01 10:00:00 UTC,`,
    `${handle},published,4,,Ben,b@example.com,,Does the job.,,2025-03-02 10:00:00 UTC,`,
    `${handle},unpublished,1,,Hidden one,h@example.com,,Not for the feed.,,2025-03-03 10:00:00 UTC,`,
  ].join("\n");
  await page.goto("/admin/reviews");
  await page.getByRole("link", { name: "Bring your reviews over" }).click();
  await page.getByLabel("Reviews file (CSV)").setInputFiles({ name: "reviews.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Add reviews" }).click();
  await expect(page.getByRole("status")).toContainText("3 reviews added");

  await page.goto("/admin/channels");
  const section = page.getByRole("region", { name: "Stars in Google Shopping" });
  await expect(section).toContainText("you have 2.");
  const link = await section.getByLabel("Google product reviews feed link").inputValue();
  expect(link).toMatch(/\/feeds\/reviews\.xml$/);

  // The browser opens the feed the way Google fetches it (store hosts only resolve in the browser).
  const response = (await page.goto(link))!;
  expect(response.headers()["content-type"]).toContain("application/xml");
  const xml = await response.text();
  const parsed = await page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    return {
      error: doc.getElementsByTagName("parsererror").length,
      names: [...doc.querySelectorAll("review reviewer name")].map((n) => n.textContent),
      stars: [...doc.querySelectorAll("review ratings overall")].map((n) => n.textContent),
    };
  }, xml);
  expect(parsed).toEqual({ error: 0, names: ["Ben", "Ada & Co"], stars: ["4", "5"] });
  expect(xml).toContain("<content>Lovely &lt;warm&gt; light.</content>");
  expect(xml).not.toContain("Hidden one");
});
