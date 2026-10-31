import { expect, test } from "@playwright/test";

// Local pickup: a store with its own stock lets buyers collect for free, tells them when it's
// ready, and marks it picked up.

test("a buyer picks up their order instead of paying for shipping", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`lp-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Corner ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Corner/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Clay Planter");
  await page.getByLabel("Price", { exact: true }).fill("24.00");
  await page.getByLabel("Stock", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  await page.getByLabel("Let buyers pick up their order").check();
  await page.getByLabel("Pickup address").fill("Corner Studio\n12 Congress Ave, Austin");
  await page.getByLabel("How to collect (optional)").fill("Ring the bell, weekdays 10 to 6.");
  await page.getByRole("button", { name: "Save pickup" }).click();
  await expect(page.getByText("Saved. Buyers can pick up orders of your own stock.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`grace-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Grace Hopper");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  // Shipping is still the default; picking up is the buyer's choice.
  const pickup = buyer.getByRole("radio", { name: /Pick it up yourself/ });
  await expect(pickup).not.toBeChecked();
  await expect(buyer.getByText("From Corner Studio")).toBeVisible();
  await pickup.check();
  await expect(buyer.getByText("Shipping (Pick it up yourself)")).toBeVisible();
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Grace!" })).toBeVisible();
  await expect(buyer.getByText("You're picking this order up. We'll email you when it's ready.")).toBeVisible();
  const orderPage = buyer.url();

  await page.goto("/admin/orders");
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByRole("heading", { name: "Order #1001" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Picking up", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ready for pickup" }).click();
  await expect(page.getByText(/^Ready since/)).toBeVisible();

  await buyer.goto(orderPage);
  await expect(buyer.getByText("Your order is ready to pick up from:")).toBeVisible();
  await expect(buyer.getByText("Ring the bell, weekdays 10 to 6.")).toBeVisible();

  await page.getByRole("button", { name: "Picked up" }).click();
  await expect(page.getByText(/^Picked up on/)).toBeVisible();
  await buyer.goto(orderPage);
  await expect(buyer.getByText("You picked up this order.")).toBeVisible();
});

test("a buyer picks the day they'll collect their order", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`lpd-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Kiln ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Kiln/ })).toBeVisible();

  await page.goto("/admin/products/new");
  await page.getByLabel("Title").fill("Stoneware Bowl");
  await page.getByLabel("Price", { exact: true }).fill("18.00");
  await page.getByLabel("Stock", { exact: true }).fill("4");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByText("Product added.")).toBeVisible();
  const store = (await page.getByRole("link", { name: "View on store ↗" }).getAttribute("href"))!;

  await page.goto("/admin/shipping");
  await page.getByLabel("Let buyers pick up their order").check();
  await page.getByLabel("Pickup address").fill("Kiln Studio\n4 Rainey St, Austin");
  await page.getByRole("button", { name: "Save pickup" }).click();
  await expect(page.getByText("Saved. Buyers can pick up orders of your own stock.")).toBeVisible();
  await page.reload();
  const days = page.getByRole("region", { name: "Pickup and delivery days" });
  await days.getByLabel("Buyers pick the day they collect or get their order").check();
  await days.getByLabel("Saturday").check();
  await days.getByLabel("Sunday").check();
  await days.getByLabel("Notice you need").selectOption("2");
  await days.getByRole("button", { name: "Save days" }).click();
  await expect(days.getByText("Saved. Buyers pick from Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday at checkout.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(store);
  await buyer.getByRole("button", { name: "Add to cart" }).click();
  await expect(buyer.getByRole("link", { name: /^Cart, 1 item/ })).toBeVisible();
  await buyer.goto(store.replace(/\/products\/.*$/, "/cart"));
  await buyer.getByRole("link", { name: "Check out" }).click();
  await buyer.getByRole("textbox", { name: "Email" }).first().fill(`linus-${id}@example.com`);
  await buyer.getByLabel("Full name").fill("Linus Pauling");
  await buyer.getByLabel("Address", { exact: true }).fill("1 Main St");
  await buyer.getByLabel("City").fill("Austin");
  await buyer.getByLabel("State or region").fill("TX");
  await buyer.getByLabel("Postal code").fill("78701");
  // Shipping needs no day; picking up does.
  await expect(buyer.getByLabel("Pickup day")).toHaveCount(0);
  await buyer.getByRole("radio", { name: /Pick it up yourself/ }).check();
  const pick = buyer.getByLabel("Pickup day");
  await expect(pick).toBeVisible();
  const options = pick.locator("option:not([value=''])");
  await expect(options).toHaveCount(14);
  let label = (await options.nth(1).textContent())!.trim();
  await pick.selectOption({ label });
  await buyer.getByRole("button", { name: "Continue to payment" }).click();
  await buyer.getByRole("button", { name: /^Pay / }).click();
  await expect(buyer.getByRole("heading", { name: "Thank you, Linus!" })).toBeVisible();
  await expect(buyer.getByText(`Pickup day: ${label}`)).toBeVisible();

  // Something came up: the buyer moves it to a later day from their order page.
  await buyer.getByText("Change the day").click();
  const moveTo = (await buyer.locator("#changeDay option").nth(4).textContent())!.trim();
  await buyer.getByLabel("Pickup day").selectOption({ label: moveTo });
  await buyer.getByRole("button", { name: "Save the new day" }).click();
  await expect(buyer.getByText(`Pickup day: ${moveTo}`)).toBeVisible();
  await expect(buyer.getByText("Saved. The store has been told.")).toBeVisible();
  const label0 = label;
  label = moveTo;

  // The order list sums up who's coming over the week.
  await page.goto("/admin/orders");
  const week = page.getByRole("region", { name: "Pickups and deliveries" });
  await expect(week.getByRole("link", { name: "Today: nothing due" })).toBeVisible();
  await week.getByRole("link", { name: `${label}: 1 pickup` }).click();
  await expect(page.getByText(`Pickups and deliveries due ${label} not handed over yet`)).toBeVisible();
  await page.getByRole("link", { name: "#1001" }).first().click();
  await expect(page.getByText(`Collecting on ${label}`)).toBeVisible();
  await expect(page.getByText(`Pickup day moved from ${label0} to ${label}`)).toBeVisible();

  // The store can move it too, and the buyer sees the new day.
  await page.getByText("Move to another day").click();
  const storeDay = (await page.locator("#move-day option").first().textContent())!.trim();
  await page.getByLabel("New day").selectOption({ label: storeDay });
  await page.getByRole("button", { name: "Move and tell the buyer" }).click();
  await expect(page.getByText("Moved. The buyer was emailed the new day.")).toBeVisible();
  await expect(page.getByText(`Collecting on ${storeDay}`)).toBeVisible();
  await buyer.reload();
  await expect(buyer.getByText(`Pickup day: ${storeDay}`)).toBeVisible();
});
