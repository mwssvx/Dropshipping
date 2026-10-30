import { expect, test } from "@playwright/test";

// The home page's columns: side-by-side blocks with a picture, a title, a few words and a
// link. A column with nothing in it yet stays hidden.

const PIC = "https://images.example.com/pick.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#8a6"/></svg>';

test("a merchant adds a how-it-works row of columns to the home page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  // Serve the picture from the test so it doesn't depend on the network.
  await page.context().route(PIC, (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`columns-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Columns ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Columns/ })).toBeVisible();
  const handle = `columns-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("columns");
  await page.getByLabel("Heading (optional)").fill("How it works");
  await page.getByRole("button", { name: "Add a column" }).click();
  await page.getByLabel("Column picture 1").fill(PIC);
  await page.getByLabel("Column title 1").fill("Pick");
  await page.getByLabel("Column text 1").fill("Choose what you like.");
  await page.getByLabel("Column link label 1").fill("Shop everything");
  await page.getByLabel("Column link 1").fill("/collections/all");
  await page.getByRole("button", { name: "Add a column" }).click();
  await page.getByLabel("Column title 2").fill("Relax");
  await page.getByRole("button", { name: "Add a column" }).click();
  const row = preview.getByRole("region", { name: "How it works" });
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByRole("heading", { name: "Pick" })).toBeVisible();
  await expect(row.getByRole("heading", { name: "Relax" })).toBeVisible();
  // The third column is still empty, so only two show.
  await expect(row.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  await buyerContext.route(PIC, (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "How it works" });
  await live.scrollIntoViewIfNeeded();
  await expect(live.getByRole("heading", { name: "Pick" })).toBeVisible();
  await expect(live.getByText("Choose what you like.")).toBeVisible();
  await live.getByRole("link", { name: "Shop everything" }).click();
  await expect(buyer).toHaveURL(new RegExp(`/s/${handle}/collections/all`));
  await buyerContext.close();
});
