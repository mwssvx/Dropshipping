import { expect, test, type Page } from "@playwright/test";

// Saved replies: the merchant keeps answers they give often and drops them into a reply, with the
// buyer's name filled in. A field the conversation can't fill has to be replaced before sending.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the merchant answers a buyer from a saved reply", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`replies-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Replies ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Replies/ })).toBeVisible();
  const handle = `replies-${id}`.toLowerCase();

  // Starter replies, then one of the merchant's own.
  await page.goto("/admin/inbox");
  await page.getByRole("link", { name: "Saved replies" }).click();
  await page.getByRole("button", { name: "Add starter replies" }).click();
  await expect(page.getByRole("region", { name: "Where is my order" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add starter replies" })).toHaveCount(0);
  const add = page.getByRole("region", { name: "Add a saved reply" });
  await add.getByLabel("Name", { exact: true }).fill("Plugs");
  await add.getByLabel("Reply", { exact: true }).fill("Hi {first_name},\n\nEvery lamp from {store_name} comes with a UK plug.");
  await add.getByRole("button", { name: "Add reply" }).click();
  await expect(page.getByText("Saved “Plugs”.")).toBeVisible();
  await expect(add.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByRole("region", { name: "Plugs" })).toBeVisible();
  // Names are unique; the form keeps what was typed after the error.
  await add.getByLabel("Name", { exact: true }).fill("plugs");
  await add.getByLabel("Reply", { exact: true }).fill("Again");
  await add.getByRole("button", { name: "Add reply" }).click();
  await expect(add.getByText('You already have a reply called "plugs".')).toBeVisible();
  await expect(add.getByLabel("Reply", { exact: true })).toHaveValue("Again");
  await shot(page, "391-saved-replies");

  // A buyer writes from the contact page.
  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`/s/${handle}/contact`);
  const email = `grace-${id}@example.com`;
  await buyer.getByLabel("Your name").fill("Grace Hopper");
  await buyer.getByLabel("Email").fill(email);
  await buyer.getByLabel("Message").fill("Do your lamps work with UK plugs?");
  await buyer.getByRole("button", { name: "Send message" }).click();
  await expect(buyer.getByText("Thanks, your message is on its way.")).toBeVisible();

  await page.goto("/admin/inbox");
  await page.getByRole("link", { name: /Message from Grace Hopper/ }).click();
  const box = page.getByLabel("Write your own reply");
  // A reply that needs an order: the number can't be filled, so it has to be replaced first.
  await page.getByLabel("Start from").selectOption({ label: "How long shipping takes" });
  await expect(box).toHaveValue(/^Hi Grace,\n\nOrders usually leave us/);
  await expect(page.getByText("Replace {order_number} before sending")).toBeVisible();
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Replace {order_number} in the reply first")).toBeVisible();
  await expect(box).toHaveValue(/Orders usually leave us/);
  // The merchant's own reply fills in completely.
  await page.getByLabel("Start from").selectOption({ label: "Plugs" });
  await expect(box).toHaveValue(`Hi Grace,\n\nEvery lamp from Replies ${id} comes with a UK plug.`);
  await expect(page.getByText("Replace {order_number} before sending")).toHaveCount(0);
  await shot(page, "392-saved-reply-picked");
  await page.getByRole("button", { name: "Send reply" }).click();
  await expect(page.getByText("Sent by email.")).toBeVisible();
  await expect(box).toHaveValue("");

  const mail = await buyer.context().newPage();
  await mail.goto("/dev/mail");
  const letter = mail.getByRole("article").filter({ hasText: email }).first();
  await expect(letter).toContainText(`Every lamp from Replies ${id} comes with a UK plug.`);
  await expect(letter).toContainText("Hi Grace,");
});
