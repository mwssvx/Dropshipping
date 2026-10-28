import { expect, test, type Page } from "@playwright/test";

// The Assistant remembers what the owner tells it, and the owner can read and edit the notes.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: false });
};

test("the assistant remembers what the owner tells it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`memory-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Memory ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Memory/ })).toBeVisible();

  await page.goto("/admin/assistant");
  await page.getByLabel("Message the assistant").fill("Remember that we only ship from the US warehouse.");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/I'll remember that: “We only ship from the US warehouse”/)).toBeVisible();
  await shot(page, "150-assistant-memory");

  await page.goto("/admin/ai");
  const notes = page.getByLabel("What the Assistant remembers");
  await expect(notes).toHaveValue("We only ship from the US warehouse");
  await notes.fill("We only ship from the US warehouse\nCall me Sam");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("What the Assistant remembers")).toHaveValue("We only ship from the US warehouse\nCall me Sam");
});
