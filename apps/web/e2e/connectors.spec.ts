import { expect, test } from "@playwright/test";

// Connecting Google (the fake one in tests), asking the Assistant about email, and disconnecting.

test("the owner connects Google and the Assistant reads their inbox", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`google-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Google ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Google/ })).toBeVisible();

  await page.goto("/admin/connectors");
  await expect(page.getByText("Not connected")).toBeVisible();
  await page.getByRole("link", { name: "Connect Google" }).click();
  await expect(page).toHaveURL(/google=connected/);
  await expect(page.getByText("Google is connected.")).toBeVisible();
  await expect(page.getByText("owner@gmail.example")).toBeVisible();

  await page.goto("/admin/assistant");
  await page.getByLabel("Message the assistant").fill("Any new emails from Demo Post?");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText(/Order CJ-1001 has shipped/)).toBeVisible();

  await page.getByLabel("Message the assistant").fill("Email ada@example.com about wholesale prices");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  const card = page.getByRole("article", { name: /Email to ada@example.com/ });
  await expect(card).toBeVisible();
  await expect(card.getByText("From owner@gmail.example to ada@example.com")).toBeVisible();

  await page.goto("/admin/connectors");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Not connected")).toBeVisible();
});
