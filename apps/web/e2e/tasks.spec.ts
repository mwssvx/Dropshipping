import { expect, test } from "@playwright/test";

// The store's to-do list: the owner adds a task, the Assistant adds one, Today shows them, and
// ticking one off moves it to Done.

test("the owner and the Assistant keep a to-do list", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`todo-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Todo ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Todo/ })).toBeVisible();

  await page.goto("/admin/tasks");
  await page.getByLabel("What needs doing").fill("Order new packaging");
  await page.getByLabel("By (optional)").fill("2030-01-15");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const open = page.getByRole("region", { name: "To do" });
  await expect(open.getByRole("checkbox", { name: "Order new packaging" })).toBeVisible();
  await expect(open.getByText("1 of 100")).toBeVisible();

  await page.goto("/admin/assistant");
  await page.getByLabel("Message the assistant").fill("Remind me to add a backup supplier for the lamp");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Added to your list: “Add a backup supplier for the lamp”/)).toBeVisible();

  await page.goto("/admin");
  const card = page.getByRole("region", { name: "To do" });
  await expect(card.getByText("Order new packaging")).toBeVisible();
  await expect(card.getByText("Add a backup supplier for the lamp")).toBeVisible();

  await page.goto("/admin/tasks");
  await page.getByRole("checkbox", { name: "Order new packaging" }).check();
  await expect(page.getByText("Done (1)")).toBeVisible();
  await expect(page.getByRole("region", { name: "To do" }).getByText("1 of 100")).toBeVisible();
});
