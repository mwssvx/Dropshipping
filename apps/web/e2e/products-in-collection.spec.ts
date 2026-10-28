import { expect, test } from "@playwright/test";

// The product list filtered to one hand-picked collection, kept by the download and saved views.

test("a merchant lists the products in one collection", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`pc-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Grouped ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Grouped/ })).toBeVisible();
  for (const title of ["Gift Mug", "Plain Tee"]) {
    await page.goto("/admin/products/new");
    await page.getByLabel("Title").fill(title);
    await page.getByLabel("Price", { exact: true }).fill("15.00");
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByText("Product added.")).toBeVisible();
  }
  await page.goto("/admin/collections/new");
  await page.getByLabel("Title").fill("Gifts");
  await page.getByRole("button", { name: /Gift Mug/ }).click();
  await page.getByRole("button", { name: "Save collection" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  await page.goto("/admin/products");
  const listed = () => page.getByRole("checkbox", { name: /^Select (?!all)/ }).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")!.replace("Select ", "")));
  await expect.poll(listed).toEqual(["Plain Tee", "Gift Mug"]);
  await page.getByLabel("In collection").selectOption({ label: "Gifts (1)" });
  await expect(page).toHaveURL(/collection=/);
  await expect.poll(listed).toEqual(["Gift Mug"]);
  const download = page.getByRole("link", { name: /Download these products/ });
  await expect(download).toHaveAttribute("href", /collection=/);
  const csv = await (await page.request.get((await download.getAttribute("href"))!)).text();
  expect(csv).toContain("Gift Mug");
  expect(csv).not.toContain("Plain Tee");
});
