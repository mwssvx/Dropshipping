import { expect, test, type Page } from "@playwright/test";

// Milestone 5 "done when": buyers get answers on their order page, the merchant checks drafts in
// the inbox, the assistant answers from real data and queues changes for approval, the listing
// writer and order fixer work, and tickets reach staff. Runs on the demo brain (no API key).

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function signUp(page: Page, email: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
}

async function newMerchant(page: Page, id: string, name = "Lumen Co") {
  await signUp(page, `m5-${id}@example.com`);
  await page.getByLabel("Store name").fill(`${name} ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`Welcome to ${name}`) })).toBeVisible();
}

async function importDemo(page: Page, name: RegExp) {
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  return { productUrl: (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!, adminUrl: page.url() };
}

async function buy(page: Page, productUrl: string) {
  await page.goto(productUrl);
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.getByRole("link", { name: "Check out" }).click();
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Full name").fill("Ada Buyer");
  await page.getByLabel("Address", { exact: true }).fill("1 Main St");
  await page.getByLabel("City").fill("Austin");
  await page.getByLabel("State or region").fill("TX");
  await page.getByLabel("Postal code").fill("78701");
  await page.getByRole("button", { name: "Continue to payment" }).click();
  await page.getByRole("button", { name: /^Pay/ }).click();
  await expect(page.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  return page.url();
}

async function reloadUntil(page: Page, check: () => Promise<void>) {
  await expect(async () => {
    await page.reload();
    await check();
  }).toPass({ timeout: 20_000 });
}

async function openOrder(page: Page) {
  await page.goto("/admin/orders");
  await page.goto((await page.getByRole("link", { name: "#1001" }).getAttribute("href"))!);
}

test("a buyer's question gets a drafted reply the merchant checks, then automatic answers", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  const { productUrl } = await importDemo(page, /sunset projection lamp/i);
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  const statusUrl = await buy(buyer, productUrl);
  await openOrder(page);
  await reloadUntil(page, () => expect(page.getByRole("button", { name: "Check for tracking now" })).toBeVisible({ timeout: 1000 }));
  await page.getByRole("button", { name: "Check for tracking now" }).click();
  await expect(page.getByText(/Shipped with Demo Post/)).toBeVisible();

  await buyer.goto(statusUrl);
  await buyer.getByLabel("Ask a question about this order").fill("Hi, where is my order?");
  await buyer.getByRole("button", { name: "Send", exact: true }).click();
  await expect(buyer.getByText("Thanks, we got your message.")).toBeVisible();
  await shot(buyer, "45-buyer-question");

  // Not allowed to answer on its own yet, so the reply waits in the inbox.
  await reloadUntil(page, async () => {
    await page.goto("/admin/inbox");
    await expect(page.getByText("Reply ready to check")).toBeVisible({ timeout: 1000 });
  });
  await shot(page, "46-inbox");
  await page.getByRole("link", { name: /Order #1001/ }).click();
  const draft = page.getByLabel("Message to the buyer");
  await expect(draft).toHaveValue(/on its way with Demo Post/);
  await shot(page, "47-inbox-draft");
  await draft.fill((await draft.inputValue()).replace("Best wishes", "Thanks for shopping with us"));
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Sent.")).toBeVisible();

  await buyer.reload();
  await expect(buyer.getByText(/Thanks for shopping with us/)).toBeVisible();
  await shot(buyer, "48-buyer-reply");

  // Let it answer "where is my order" questions itself from now on.
  await page.goto("/admin/ai");
  await page.getByLabel("Where is my order").check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await shot(page, "49-ai-settings");

  await buyer.getByLabel("Ask a question about this order").fill("Can you send me the tracking link again?");
  await buyer.getByRole("button", { name: "Send", exact: true }).click();
  await reloadUntil(buyer, () => expect(buyer.getByText(/you can follow it here/).nth(1)).toBeVisible({ timeout: 1000 }));
});

test("the assistant answers from real data, and changes wait for an OK", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  const { productUrl, adminUrl } = await importDemo(page, /magnetic phone stand/i);
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buy(buyer, productUrl);

  // The listing writer: the product is on sale, so the new wording waits for approval.
  await page.goto(adminUrl);
  await page.getByRole("button", { name: "Write with AI" }).click();
  await expect(page.getByText(/waiting for your OK/)).toBeVisible();
  await shot(page, "50-write-with-ai");

  await page.goto("/admin/assistant");
  await expect(page.getByRole("article", { name: /New title and description/ })).toBeVisible();
  await page.getByRole("button", { name: "How am I doing this month?" }).click();
  await expect(page.getByText(/In the last 30 days .* had 1 order/)).toBeVisible();
  await page.getByRole("button", { name: "What are shoppers searching for?" }).click();
  await expect(page.getByText("Nobody has searched your store in the last 30 days yet.")).toBeVisible();
  await page.getByLabel("Message the assistant").fill("Please show prices with VAT included");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const setting = page.getByRole("article", { name: "Show prices with tax included" });
  await expect(setting).toBeVisible();
  await shot(page, "51-assistant");

  await setting.getByRole("button", { name: "Don't do it" }).click();
  await expect(page.getByText("Turned down. Nothing was changed.")).toBeVisible();
  await page.getByRole("article", { name: /New title and description/ }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Done.")).toBeVisible();
  await page.goto(adminUrl);
  await expect(page.getByLabel("Title")).toHaveValue("Magnetic Phone Stand");

  await page.goto("/admin/ai");
  await expect(page.getByRole("cell", { name: /New title and description/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Show prices with tax added at checkout" }).or(page.getByRole("cell", { name: "Show prices with tax included" }))).toBeVisible();
});

test("the order fixer proposes a refund for an out-of-stock order, and nothing moves until approved", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);
  const { productUrl } = await importDemo(page, /galaxy projector low stock/i);
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buy(buyer, productUrl);

  await openOrder(page);
  await reloadUntil(page, () => expect(page.getByRole("button", { name: "Ask AI to sort it out" })).toBeVisible({ timeout: 1000 }));
  await page.getByRole("button", { name: "Ask AI to sort it out" }).click();
  await expect(page.getByText(/proposed a full refund/)).toBeVisible();
  await shot(page, "52-fix-with-ai");

  await page.getByRole("link", { name: /See what's waiting for your OK/ }).click();
  const refund = page.getByRole("article", { name: /Refund \$[\d.]+ on order #1001/ });
  await expect(refund).toBeVisible();
  await expect(page.getByRole("link", { name: /1 drafted reply is waiting in the inbox/ })).toBeVisible();
  await shot(page, "53-approvals");
  await refund.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Done.")).toBeVisible();

  await openOrder(page);
  await expect(page.getByText("Refunded", { exact: true }).first()).toBeVisible();
  await page.goto("/admin/inbox");
  await expect(page.getByText("Reply ready to check")).toBeVisible();
});

test("a ticket from the assistant reaches staff, and the answer comes back in the chat", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const store = `Ticket Test ${id}`;
  await newMerchant(page, id, "Ticket Test");
  await page.goto("/admin/assistant");
  await page.getByLabel("Message the assistant").fill("My payout is on hold, can a person help?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/asked our support team/)).toBeVisible();

  const staff = await (await browser.newContext({ ...info.project.use })).newPage();
  await signUp(staff, `staff-m5-${info.project.name}@example.com`);
  await expect(staff.getByLabel("Store name")).toBeVisible();
  await staff.goto("/staff");
  const ticket = staff.getByRole("article").filter({ hasText: store });
  await expect(ticket.getByText("Merchant ticket")).toBeVisible();
  await shot(staff, "54-staff-escalations");
  await ticket.getByLabel(/Reply to the merchant/).fill("We released the hold. It pays out tomorrow.");
  await ticket.getByRole("button", { name: "Send", exact: true }).click();
  // "Close it" is ticked by default, so the ticket leaves the list.
  await expect(ticket).toHaveCount(0);

  await page.reload();
  await expect(page.getByText(/Our support team replied/)).toBeVisible();
  await expect(page.getByText(/released the hold/)).toBeVisible();
});
