import { expect, test } from "@playwright/test";

// The owner adds their own skill (pasted here; GitHub links fetch the same way) and the Assistant
// lists it; removing it takes it away again.

test("the owner adds a skill of their own and removes it", async ({ page }, info) => {
  const id = `${info.project.name}-${Date.now()}`;
  await page.goto("/signup");
  await page.getByLabel("Email").fill(`skill-${id}@example.com`);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByLabel("Store name").fill(`Skills ${id}`);
  await page.getByRole("button", { name: "Create store" }).click();
  await expect(page.getByRole("heading", { name: /Welcome to Skills/ })).toBeVisible();

  await page.goto("/admin/ai");
  const library = page.getByRole("region", { name: "Your skills" });
  await expect(library.getByText("None yet.")).toBeVisible();
  await library.getByText("Or paste a skill").click();
  await library.getByLabel("Skill text").fill("---\nname: email-sequence\ndescription: Writing a welcome email series for new subscribers\n---\n# Email sequences\n\nWrite 3 to 5 short emails, one idea each, with a single link.");
  await library.getByRole("button", { name: "Add skill" }).click();
  await expect(library.getByText(/Added “Email sequences”/)).toBeVisible();
  await expect(library.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Remove Email sequences" }) })).toContainText("For writing a welcome email series for new subscribers.");
  await expect(library.getByText("1 of 12.")).toBeVisible();

  // A bad link is refused with a plain reason.
  await library.getByLabel("GitHub link to a skill").fill("https://gitlab.com/someone/skills");
  await library.getByRole("button", { name: "Add skill" }).click();
  await expect(library.getByText(/Only GitHub links work here/)).toBeVisible();

  await library.getByRole("button", { name: "Remove Email sequences" }).click();
  await expect(library.getByText("None yet.")).toBeVisible();
});
