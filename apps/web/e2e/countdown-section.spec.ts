import { expect, test } from "@playwright/test";

// The home page countdown: a clock ticking down to a launch or a sale, which hides itself once
// that moment has passed.

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

test("a merchant counts down to a sale on the home page", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`countdown-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Countdown ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Countdown/ })).toBeVisible();
  const handle = `countdown-${id}`.toLowerCase();

  await page.goto("/admin/theme");
  const preview = page.frameLocator('iframe[title="Store preview"]');
  await preview.getByRole("heading", { name: /Welcome/ }).waitFor();
  await page.getByLabel("Add a section").selectOption("countdown");
  await page.getByLabel("Heading").fill("Black Friday starts in");
  const clock = preview.getByRole("region", { name: "Black Friday starts in" });
  // Nothing shows until there's a time to count down to, nor once it has passed.
  await expect(clock).toHaveCount(0);
  await page.getByLabel("Count down to").fill(local(new Date(Date.now() - 60_000)));
  await expect(clock).toHaveCount(0);
  await page.getByLabel("Count down to").fill(local(new Date(Date.now() + 2 * 86_400_000 + 3_600_000)));
  await clock.scrollIntoViewIfNeeded();
  await expect(clock.getByRole("timer")).toContainText("Days");
  await expect(clock.getByRole("timer")).toContainText(/02\s*Days/);
  await page.getByLabel("Button label").fill("Shop early");
  await page.getByLabel("Button link").fill("/collections/all");
  await expect(clock.getByRole("link", { name: "Shop early" })).toBeVisible();
  await expect(page.getByText("Draft saved. Not live yet.")).toBeVisible();
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("Everything is live.")).toBeVisible();

  const buyer = await (await browser.newContext({ ...info.project.use })).newPage();
  await buyer.goto(`/s/${handle}`);
  const live = buyer.getByRole("region", { name: "Black Friday starts in" });
  await live.scrollIntoViewIfNeeded();
  const timer = live.getByRole("timer");
  await expect(timer).toContainText(/02\s*Days/);
  // It ticks.
  const before = await timer.innerText();
  await expect.poll(() => timer.innerText(), { timeout: 5000 }).not.toBe(before);
  await live.getByRole("link", { name: "Shop early" }).click();
  await expect(buyer).toHaveURL(new RegExp(`/s/${handle}/collections/all`));
  await buyer.context().close();
});
