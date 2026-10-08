import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";

// Milestone 9: staff accounts. The owner invites people by email, each role sees only its part of
// the store, and the owner can change or remove anyone. Set SCREENSHOTS_DIR to also save the screens.

const dir = process.env.SCREENSHOTS_DIR;
const shot = async (p: Page, name: string) => {
  if (dir && test.info().project.name === "desktop") await p.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
};

async function newMerchant(page: Page, id: string) {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`m9-owner-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Lumen ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Lumen/ })).toBeVisible();
}

/** The development outbox stands in for the person's inbox. */
async function inviteLink(page: Page, email: string) {
  await page.goto("/dev/mail");
  const mail = page.getByRole("article").filter({ hasText: email }).first();
  await expect(mail).toContainText("Join Lumen");
  return new URL((await mail.textContent())!.match(/https?:\/\/\S+\/invite\/[\w-]+/)![0]).pathname;
}

async function newPerson(browser: Browser, info: TestInfo) {
  return (await browser.newContext({ ...info.project.use })).newPage();
}

test("the owner invites staff, who only see orders and products, then makes them an admin", async ({ page, browser }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await newMerchant(page, id);

  // Staff accounts come with Scale.
  await page.getByRole("link", { name: "Team" }).first().click();
  await expect(page.getByText("Staff accounts come with the Scale plan")).toBeVisible();
  await page.goto("/admin/plan");
  await page.getByRole("button", { name: "Upgrade to Scale" }).click();
  await expect(page.getByRole("heading", { name: "You're on Scale" })).toBeVisible();

  await page.goto("/admin/team");
  await expect(page.getByText("0 of 15 staff accounts used")).toBeVisible();
  const staffEmail = `m9-sam-${id}@example.com`;
  await page.getByRole("textbox", { name: "Email" }).fill(staffEmail);
  await page.getByLabel("Role", { exact: true }).selectOption("staff");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toContainText(`Invite sent to ${staffEmail}`);
  await expect(page.getByRole("listitem", { name: `Invite for ${staffEmail}` })).toContainText("Invited as staff");
  await shot(page, "84-team");

  // Sam opens the link, creates an account with that email and joins.
  const link = await inviteLink(page, staffEmail);
  const sam = await newPerson(browser, info);
  await sam.goto(link);
  await expect(sam.getByRole("heading", { name: `Join Lumen ${id}` })).toBeVisible();
  await shot(sam, "85-invite");
  await sam.getByRole("link", { name: "Create an account" }).click();
  await expect(sam.getByRole("heading", { name: "Create your account to join the team" })).toBeVisible();
  await expect(sam.getByLabel("Email")).toHaveValue(staffEmail);
  await sam.getByLabel("Password").fill("correct horse battery");
  await sam.getByRole("button", { name: "Create account" }).click();
  await sam.getByRole("button", { name: `Join Lumen ${id}` }).click();
  await expect(sam.getByRole("heading", { name: `Welcome to Lumen ${id}` })).toBeVisible();

  // Staff: orders and products, no money, settings or sales totals.
  const nav = sam.getByRole("navigation", { name: "Admin" });
  await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Products" })).toBeVisible();
  for (const hidden of ["Money", "Analytics", "Assistant", "Theme", "Plan", "Developers"]) await expect(nav.getByRole("link", { name: hidden, exact: true })).toHaveCount(0);
  await expect(sam.getByText("Sales today")).toHaveCount(0);
  await sam.goto("/admin/money");
  await expect(sam).toHaveURL(/\/admin\?denied=money/);
  await expect(sam.getByRole("status")).toContainText("Your role on this store doesn't include that page");
  await shot(sam, "86-staff-home");
  // The merchant app's API says no too.
  const login = await sam.request.post("/api/app/v1/auth/login", { data: { email: staffEmail, password: "correct horse battery" } });
  const { token } = await login.json();
  const app = (path: string) => sam.request.get(`/api/app/v1/${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect((await app("money")).status()).toBe(403);
  expect((await app("orders")).status()).toBe(200);
  expect(await (await app("me")).json()).toMatchObject({ role: "staff", can: expect.not.arrayContaining(["money"]) });
  expect(await (await app("today")).json()).toMatchObject({ salesTodayMinor: null });

  // The owner sees Sam on the team and makes them an admin.
  await page.goto("/admin/team");
  const row = page.getByRole("listitem", { name: staffEmail });
  await expect(row).toBeVisible();
  await row.getByLabel(`Role for ${staffEmail}`).selectOption("admin");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByLabel(`Role for ${staffEmail}`)).toHaveValue("admin");

  await sam.goto("/admin/money");
  await expect(sam.getByRole("heading", { name: "Money" })).toBeVisible();
  await expect(sam.getByRole("navigation", { name: "Admin" }).getByRole("link", { name: "Plan" })).toHaveCount(0);
  await sam.goto("/admin/plan");
  await expect(sam).toHaveURL(/denied=plan/);

  // Removed: Sam no longer gets into the store.
  await page.goto("/admin/team");
  await page.getByRole("button", { name: `Remove ${staffEmail}` }).click();
  await expect(page.getByRole("listitem", { name: staffEmail })).toHaveCount(0);
  await sam.goto("/admin/orders");
  await expect(sam).toHaveURL(/\/admin\/new-store/);
});

test("an invite only works for the email it was sent to", async ({ page, browser }, info) => {
  const id = `${info.project.name}-email-${Date.now()}`;
  await newMerchant(page, id);
  await page.goto("/admin/plan");
  await page.getByRole("button", { name: "Upgrade to Scale" }).click();
  await expect(page.getByRole("heading", { name: "You're on Scale" })).toBeVisible();
  await page.goto("/admin/team");
  const invited = `m9-kim-${id}@example.com`;
  await page.getByRole("textbox", { name: "Email" }).fill(invited);
  await page.getByLabel("Role", { exact: true }).selectOption("admin");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByRole("status")).toContainText("Invite sent");
  const link = await inviteLink(page, invited);

  // Someone signed in with another email is told to switch accounts.
  const other = await newPerson(browser, info);
  await other.goto("/signup");
  await other.getByLabel("Email").fill(`m9-other-${id}@example.com`);
  await other.getByLabel("Password").fill("correct horse battery");
  await other.getByRole("button", { name: "Create account" }).click();
  await expect(other.getByLabel("Store name")).toBeVisible();
  await other.goto(link);
  await expect(other.getByRole("status")).toContainText(`the invite is for ${invited}`);
  await expect(other.getByRole("button", { name: /^Join/ })).toHaveCount(0);

  // A cancelled invite stops working.
  await page.goto("/admin/team");
  await page.getByRole("button", { name: `Cancel invite for ${invited}` }).click();
  await expect(page.getByRole("listitem", { name: `Invite for ${invited}` })).toHaveCount(0);
  await other.goto(link);
  await expect(other.getByRole("heading", { name: "This invite can't be used" })).toBeVisible();
});
