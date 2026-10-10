import { expect, test, type Page } from "@playwright/test";

// Product questions: a shopper asks on the product page, the merchant answers from the AI's draft,
// the shopper gets the answer by email and the next shopper sees it on the page.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a shopper asks about a product and gets the merchant's answer", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`qa-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Answers ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Answers/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const lamp = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  // The shopper asks.
  const email = `ada-${id}@example.com`;
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(lamp);
  const questions = buyer.getByRole("region", { name: "Questions" });
  await expect(questions).toContainText("No questions yet.");
  const ask = questions.getByRole("form", { name: "Ask a question" });
  await ask.getByLabel("Your question").fill("How long does delivery take to Texas?");
  await ask.getByLabel("Your name").fill("Ada Lovelace");
  await ask.getByLabel("Email").fill(email);
  await ask.getByRole("button", { name: "Send question" }).click();
  await expect(buyer.getByText("Thanks! We'll email you the answer.")).toBeVisible();

  // The merchant drafts an answer with AI, changes it and sends it.
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "Questions 1" })).toBeVisible();
  await page.getByRole("link", { name: "Questions 1" }).click();
  const card = page.getByRole("listitem", { name: "Question from Ada Lovelace" });
  await expect(card).toContainText("How long does delivery take to Texas?");
  await card.getByRole("button", { name: "Draft with AI" }).click();
  await expect(card.getByText("Drafted. Read it over")).toBeVisible();
  const box = card.getByLabel("Answer", { exact: true });
  await expect(box).toHaveValue(/^Thanks for asking! It usually arrives in \d+ to \d+ days/);
  await shot(page, "145-question-drafted");
  await box.fill(`${await box.inputValue()} It ships from our partner warehouse with tracking.`);
  await card.getByRole("button", { name: "Send answer" }).click();
  const done = page.getByRole("listitem", { name: "Question from Ada Lovelace" });
  await expect(done).toContainText("On the product page");
  await expect(done).toContainText("It ships from our partner warehouse with tracking.");
  await expect(page.getByRole("link", { name: "Questions", exact: true })).toBeVisible();
  await shot(page, "146-questions-admin");

  // The answer arrives by email, and the next shopper sees it on the page.
  const inbox = await buyer.context().newPage();
  await inbox.goto("/dev/mail");
  const mail = inbox.getByRole("article").filter({ hasText: email }).first();
  await expect(mail.getByRole("heading")).toHaveText(/Your question about Sunset Projection Lamp/);
  await expect(mail).toContainText("It ships from our partner warehouse with tracking.");
  await inbox.close();
  await buyer.reload();
  await expect(questions).toContainText("How long does delivery take to Texas?");
  await expect(questions).toContainText("· Ada");
  await expect(questions).toContainText("It ships from our partner warehouse with tracking.");
  await expect(questions).not.toContainText(email);
  await shot(buyer, "147-questions-on-product");
});
