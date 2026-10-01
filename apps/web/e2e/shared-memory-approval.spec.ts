import { expect, test } from "@playwright/test";
import { captureScreenshot, completeOnboarding, signup } from "./helpers";

test("shared memory save asks with Allow once and Deny only", async ({ page }, testInfo) => {
  const stamp = Date.now();
  await signup(page, `shared-memory-${stamp}@rakazo.test`, "password12", "Shared Memory");
  await completeOnboarding(page);

  const composer = page.getByRole("combobox", { name: "Message Chief" });
  await composer.fill("save shared memory MEMORY.md with: Printing jobs go to Clyde.");
  await composer.press("Enter");

  await expect(
    page.getByText("Review before saving shared memory “MEMORY.md”", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Printing jobs go to Clyde.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deny", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Always allow this tool" })).toHaveCount(0);
  await captureScreenshot(page, testInfo, "shared-memory-approval-card");
});
