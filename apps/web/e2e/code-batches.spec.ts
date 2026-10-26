import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

// One-time codes: the merchant makes a batch of codes with one offer, downloads them, and each
// works for one order.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("the merchant makes one-time codes and each works once", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`batch-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Batch ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Batch/ })).toBeVisible();
  await page.goto("/admin/products/import");
  await page.getByRole("link", { name: /sunset projection lamp/i }).click();
  await page.getByRole("button", { name: "Import and publish" }).click();
  await expect(page.getByText("Imported and live on your store.")).toBeVisible();
  const product = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/marketing");
  const section = page.getByRole("region", { name: "One-time codes" });
  await section.getByLabel("Batch name").fill("Parcel cards");
  await section.getByLabel("Codes start with").fill("thanks!");
  await section.getByLabel("How many").fill("25");
  await section.getByLabel("Each code gives").selectOption("amount");
  await section.getByLabel("Off each order ($)").fill("5");
  await section.getByRole("button", { name: "Make codes" }).click();
  await expect(section.getByText("The start of each code is 2 to 12 letters or numbers, like THANKS.")).toBeVisible();
  // What was typed stays after the error.
  await expect(section.getByLabel("Batch name")).toHaveValue("Parcel cards");
  await section.getByLabel("Codes start with").fill("thanks");
  await section.getByRole("button", { name: "Make codes" }).click();
  await expect(section.getByText("Made 25 codes for Parcel cards.")).toBeVisible();
  const row = section.getByRole("listitem").filter({ hasText: "Parcel cards" });
  await expect(row).toContainText("$5.00 off");
  await expect(row).toContainText("0 of 25 used");
  await shot(page, "420-one-time-codes");

  const [download] = await Promise.all([page.waitForEvent("download"), row.getByRole("link", { name: "Download the Parcel cards codes" }).click()]);
  expect(download.suggestedFilename()).toMatch(/-codes-thanks\.csv$/);
  const lines = (await readFile((await download.path())!, "utf8")).trimEnd().split("\n");
  expect(lines[0]).toBe("Code,Used,Order,Used on");
  expect(lines).toHaveLength(26);
  const code = lines[1]!.split(",")[0]!;
  expect(code).toMatch(/^THANKS-[A-Z2-9]{8}$/);

  // A buyer pays with one code.
  const shopper = async () => {
    const b = await (await browser.newContext({ ...info.project.use })).newPage();
    await b.goto(product);
    await b.getByRole("button", { name: "Add to cart" }).click();
    return b;
  };
  const apply = async (b: Page, c: string) => {
    await b.getByLabel("Discount or gift card code").fill(c.toLowerCase());
    await b.getByRole("button", { name: "Apply" }).click();
  };
  const buyer = await shopper();
  await apply(buyer, code);
  await expect(buyer.getByText(`Discount (${code})`)).toBeVisible();
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByLabel("Email").fill("ada@example.com");
  await buyer.getByLabel("Full name").fill("Ada Buyer");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay/ }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Ada!" })).toBeVisible();
  await page.reload();
  await expect(row).toContainText("1 of 25 used");

  // Used once, it's gone for everyone; turned off, the rest stop working too.
  const next = await shopper();
  await apply(next, code);
  await expect(next.getByText(`The code ${code} has been used up.`)).toBeVisible();
  await row.getByRole("button", { name: "Turn off the Parcel cards codes" }).click();
  await expect(row).toContainText("Turned off");
  const other = lines[2]!.split(",")[0]!;
  await apply(next, other);
  await expect(next.getByText(`"${other}" isn't a valid code.`)).toBeVisible();
});
