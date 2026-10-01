import { expect, test } from "@playwright/test";
import type { ComputerStatus } from "@rakazo/contracts";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("computer sleep policy persists after reload", async ({ page }, testInfo) => {
  await signup(page, `computer-awake-${Date.now()}@rakazo.test`, "password12", "Computer Settings");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await page.getByTitle("Agent computer").click();
  const policy = page.getByRole("combobox", { name: "Keep awake" });
  await expect(policy).toHaveValue("automatic");
  await policy.selectOption("always");
  await expect
    .poll(async () => (await rpc<ComputerStatus>(page, "computer/status", { botId })).sleepPolicy)
    .toBe("always");
  await page.reload();
  await page.getByTitle("Agent computer").click();
  await expect(policy).toHaveValue("always");
  await policy.selectOption("app_open");
  await expect
    .poll(async () => (await rpc<ComputerStatus>(page, "computer/status", { botId })).sleepPolicy)
    .toBe("app_open");
  await rpc(page, "computer/appHeartbeat", {});
  await captureScreenshot(page, testInfo, "computer-keep-awake");
});
