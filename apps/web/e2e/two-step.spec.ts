import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

// Two-step sign-in: after the password, a code from an authenticator app (or a recovery code), on
// the web and in the merchant app.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

/** What an authenticator app shows for a base32 key, a number of 30-second steps from now. */
function appCode(key: string, ahead = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of key.replace(/\s/g, "")) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + ahead));
  const mac = createHmac("sha1", bytes).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("two-step sign-in asks for a code after the password, on the web and in the app", async ({ page, context }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  const email = `two-${id}@example.com`;
  const password = "correct horse battery";
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Two ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Two/ })).toBeVisible();

  // Set it up: scan, then confirm with a code.
  await page.goto("/admin/account");
  const section = page.getByRole("region", { name: "Two-step sign-in" });
  await expect(section.getByText("Off", { exact: true })).toBeVisible();
  await section.getByRole("button", { name: "Set up two-step sign-in" }).click();
  await expect(section.getByRole("img", { name: /QR code/ })).toBeVisible();
  const key = (await section.getByLabel("Setup key").textContent())!.replace(/\s/g, "");
  expect(key).toMatch(/^[A-Z2-7]{32}$/);
  await shot(page, "397-two-step-setup");
  await section.getByLabel("Code from your app").fill("000000");
  await section.getByRole("button", { name: "Turn on" }).click();
  await expect(section.getByText("That code isn't right")).toBeVisible();
  await section.getByLabel("Code from your app").fill(appCode(key));
  await section.getByRole("button", { name: "Turn on" }).click();
  const list = section.getByRole("list", { name: "Recovery codes" });
  await expect(list.getByRole("listitem")).toHaveCount(10);
  const codes = (await list.getByRole("listitem").allTextContents()).map((c) => c.trim());
  await shot(page, "398-two-step-codes");
  await section.getByRole("button", { name: "I've saved them" }).click();
  await expect(section.getByText("On", { exact: true })).toBeVisible();
  await expect(section.getByText("10 recovery codes left.")).toBeVisible();

  // Signing in again takes the password and then a code. (The code just used can't be used
  // again, so this one is from the next 30 seconds, which apps on a fast clock show.)
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login\/code$/);
  await expect(page.getByRole("heading", { name: "Enter your code" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);
  await page.goBack();
  await page.getByLabel("Code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That code isn't right")).toBeVisible();
  await page.getByLabel("Code").fill(appCode(key, 1));
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // The merchant app asks for the code too; a recovery code works there, once.
  const login = await page.request.post("/api/app/v1/auth/login", { data: { email, password } });
  const { twoStep, token: none } = await login.json();
  expect(twoStep).toBeTruthy();
  expect(none).toBeUndefined();
  const wrong = await page.request.post("/api/app/v1/auth/two-step", { data: { twoStep, code: "999999" } });
  expect(wrong.status()).toBe(400);
  const done = await page.request.post("/api/app/v1/auth/two-step", { data: { twoStep, code: codes[0] } });
  const { token } = await done.json();
  expect((await page.request.get("/api/app/v1/me", { headers: { authorization: `Bearer ${token}` } })).status()).toBe(200);
  await page.reload();
  await page.goto("/admin/account");
  await expect(section.getByText("9 recovery codes left.")).toBeVisible();

  // Turning it off takes the password and a code; then the password is enough again.
  await section.getByLabel("Your password").fill(password);
  await section.getByLabel("Code from your app or a recovery code").fill(codes[1]!);
  await section.getByRole("button", { name: "Turn off two-step sign-in" }).click();
  await expect(section.getByText("Off", { exact: true })).toBeVisible();
  await context.clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
});
