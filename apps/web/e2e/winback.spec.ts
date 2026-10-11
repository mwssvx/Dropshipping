import { expect, test, type Page } from "@playwright/test";

// Win-back emails: the merchant turns them on from the Marketing page. Sending is covered in the
// core tests, since it needs months to pass.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

test("merchants turn on win-back emails", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`wb-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lamps ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lamps/ })).toBeVisible();

  await page.goto("/admin/marketing");
  const section = page.getByRole("region", { name: "Win-back emails" });
  await expect(section.getByRole("definition").first()).toHaveText("0");
  await section.getByLabel("Email a code to subscribers who haven't ordered in a while").check();
  await section.getByLabel("After their last order").selectOption("60");
  await section.getByLabel("Percent off").fill("60");
  await section.getByRole("button", { name: "Save win-back emails" }).click();
  await expect(section.getByRole("alert")).toContainText("The win-back offer is 5% to 50% off.");
  // Nothing typed is lost.
  await expect(section.getByLabel("Email a code to subscribers who haven't ordered in a while")).toBeChecked();
  await expect(section.getByLabel("After their last order")).toHaveValue("60");

  await section.getByLabel("Percent off").fill("15");
  await section.getByRole("button", { name: "Save win-back emails" }).click();
  await expect(section.getByText("Saved. Codes go out with the daily emails.")).toBeVisible();
  await expect(section.getByRole("note")).toHaveText("Nobody is due one right now.");
  await shot(page, "311-winback-settings");

  await page.reload();
  await expect(section.getByLabel("After their last order")).toHaveValue("60");
  await expect(section.getByLabel("Percent off")).toHaveValue("15");
  await section.getByLabel("Email a code to subscribers who haven't ordered in a while").uncheck();
  await section.getByRole("button", { name: "Save win-back emails" }).click();
  await expect(section.getByText("Turned off. Codes already sent still work.")).toBeVisible();
  await expect(section.getByRole("note")).toHaveCount(0);
});
