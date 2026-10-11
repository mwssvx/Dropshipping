import { expect, test, type Page } from "@playwright/test";

// The store's contact page: messages land in the merchant's inbox, and replies go out by email.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("a buyer writes from the contact page and the merchant replies", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`contact-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Contact ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Contact/ })).toBeVisible();
  const handle = `contact-${id}`.toLowerCase();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`/s/${handle}`);
  await buyer.getByRole("navigation", { name: "Footer" }).getByRole("link", { name: "Contact us" }).click();
  await expect(buyer.getByRole("heading", { name: "Contact us" })).toBeVisible();
  const email = `grace-${id}@example.com`;
  await buyer.getByLabel("Your name").fill("Grace");
  await buyer.getByLabel("Email").fill(email);
  // Too short for the store to help: the browser's own check is lifted to see the store's answer.
  await buyer.getByLabel("Message").evaluate((el) => el.removeAttribute("minlength"));
  await buyer.getByLabel("Message").fill("Hi");
  await buyer.getByRole("button", { name: "Send message" }).click();
  await expect(buyer.getByText("Write a little more, so the store can help.")).toBeVisible();
  await expect(buyer.getByLabel("Your name")).toHaveValue("Grace");
  await buyer.getByLabel("Message").fill("Do your lamps work with UK plugs?");
  await shot(buyer, "381-contact-page");
  await buyer.getByRole("button", { name: "Send message" }).click();
  await expect(buyer.getByText("Thanks, your message is on its way. We'll reply by email.")).toBeVisible();

  // It waits in the merchant's inbox.
  await page.goto("/admin/inbox");
  await page.getByRole("link", { name: /Message from Grace/ }).click();
  await expect(page.getByText("Do your lamps work with UK plugs?")).toBeVisible();
  await expect(page.getByRole("heading", { name: "From your contact page" })).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByLabel("Write your own reply").fill("Yes, every lamp comes with a UK plug.");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Sent by email.")).toBeVisible();
  await shot(page, "382-contact-inbox");

  // The reply reaches the buyer, with a way to write back.
  const mail = await buyer.context().newPage();
  await mail.goto("/dev/mail");
  const letter = mail.getByRole("article").filter({ hasText: email }).first();
  await expect(letter.getByRole("heading")).toHaveText(`Re: your message to Contact ${id}`);
  await expect(letter).toContainText("Yes, every lamp comes with a UK plug.");
  await expect(letter).toContainText("/contact");
});
