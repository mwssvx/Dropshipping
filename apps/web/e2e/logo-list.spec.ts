import { expect, test } from "@playwright/test";

// The home page's logo row: press or brand logos, each with its name as the image's text and
// an optional link. A logo with no image yet stays hidden.

const LOGO = "https://logos.example.com/daily-press.svg";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40"><rect width="160" height="40" fill="#333"/></svg>';

test("a merchant adds a row of press logos to the home page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  // Serve the logo from the test so it doesn't depend on the network.
  await page.context().route(LOGO, (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`logos-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Logos ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Logos/ })).toBeVisible();
  const handle = `logos-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("logo_list");
  await page.getByLabel("Heading (optional)").fill("As seen in");
  await page.getByRole("button", { name: "Add a logo" }).click();
  await page.getByLabel("Logo image 1").fill(LOGO);
  await page.getByLabel("Logo name 1").fill("Daily Press");
  await page.getByLabel("Logo link 1").fill("https://example.com/review");
  await page.getByRole("button", { name: "Add a logo" }).click();
  await page.getByLabel("Logo name 2").fill("Not ready yet");
  const row = preview.getByRole("region", { name: "As seen in" });
  // Logos load lazily, so scroll to them as a shopper would.
  await row.scrollIntoViewIfNeeded();
  await expect(row.getByRole("img", { name: "Daily Press" })).toBeVisible();
  await expect(row.getByRole("img", { name: "Not ready yet" })).toHaveCount(0);
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  await buyerContext.route(LOGO, (r) => r.fulfill({ contentType: "image/svg+xml", body: SVG }));
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "As seen in" });
  await live.scrollIntoViewIfNeeded();
  await expect(live.getByRole("img", { name: "Daily Press" })).toBeVisible();
  await expect(live.getByRole("link", { name: "Daily Press" })).toHaveAttribute("href", "https://example.com/review");
  await buyerContext.close();
});
