import { expect, test } from "@playwright/test";

// The theme editor's Menus tab takes the store's social pages, shown as icons in the footer.

test("a merchant links the store's social pages from its footer", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`social-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Social ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Social/ })).toBeVisible();
  const handle = `social-${id}`.toLowerCase();

  const buyerContext = await browser.newContext(info.project.use);
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  await expect(buyer.getByRole("list", { name: "Follow us" })).toHaveCount(0);

  await page.goto("/admin/theme");
  await page.frameLocator('iframe[title="Store preview"]').getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByRole("tab", { name: "Menus" }).click();
  const x = page.getByLabel("X", { exact: true });
  await x.fill("https://www.instagram.com/mystore");
  await x.blur();
  await expect(page.getByText("Paste the link to your X page")).toBeVisible();
  await x.fill("@mystore");
  await x.blur();
  await expect(x).toHaveValue("https://x.com/mystore");
  await expect(page.getByText("Paste the link to your X page")).toHaveCount(0);
  await page.getByLabel("Instagram").fill("instagram.com/mystore");
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  await buyer.reload();
  const icons = buyer.getByRole("contentinfo").getByRole("list", { name: "Follow us" });
  await expect(icons.getByRole("link")).toHaveCount(2);
  await expect(icons.getByRole("link", { name: "Follow us on Instagram" })).toHaveAttribute("href", "https://instagram.com/mystore");
  const onX = icons.getByRole("link", { name: "Follow us on X" });
  await expect(onX).toHaveAttribute("href", "https://x.com/mystore");
  await expect(onX).toHaveAttribute("target", "_blank");
  // Search engines learn the pages are the store's own.
  const ld = await buyer.locator('script[type="application/ld+json"]').allTextContents();
  const org = ld.map((t) => JSON.parse(t)).find((d) => d["@type"] === "Organization");
  expect(org.sameAs).toEqual(["https://instagram.com/mystore", "https://x.com/mystore"]);
  await buyerContext.close();
});
