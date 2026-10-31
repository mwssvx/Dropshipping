import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// The home page's contact form: shoppers write without leaving the page, and the message lands in
// the merchant's inbox like one from the Contact page.

test("a shopper writes from the contact form on the home page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`ask-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Ask ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Ask/ })).toBeVisible();
  const handle = `ask-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("contact_form");
  // Empty, it says "Contact us" in the shopper's language; the preview can't send.
  const draft = preview.getByRole("region", { name: "Contact us" });
  await draft.scrollIntoViewIfNeeded();
  await expect(draft.getByRole("button", { name: "Send message" })).toBeDisabled();
  await page.getByLabel("Heading").fill("Ask us anything");
  await page.getByLabel("Text", { exact: true }).fill("We answer within a day, Monday to Friday.");
  await expect(preview.getByRole("region", { name: "Ask us anything" }).getByText("We answer within a day, Monday to Friday.")).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyerContext = await browser.newContext({ ...info.project.use });
  const buyer = await buyerContext.newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "Ask us anything" });
  await live.scrollIntoViewIfNeeded();
  const result = await new AxeBuilder({ page: buyer }).include('section[aria-label="Ask us anything"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(result.violations.map((v) => v.id)).toEqual([]);
  await live.getByLabel("Your name").fill("Ada");
  await live.getByLabel("Email").fill(`ada-${id}@example.com`);
  await live.getByLabel("Message").fill("Does the lamp come with a timer?");
  await live.getByRole("button", { name: "Send message" }).click();
  await expect(live.getByText("Thanks, your message is on its way. We'll reply by email.")).toBeVisible();
  await expect(buyer).toHaveURL(new RegExp(`/s/${handle}/?$`));
  await buyerContext.close();

  await page.goto("/admin/inbox");
  await page.getByRole("link", { name: /Message from Ada/ }).click();
  await expect(page.getByText("Does the lamp come with a timer?")).toBeVisible();
});
