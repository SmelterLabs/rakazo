import { expect, test } from "@playwright/test";
import { activeBotId, captureScreenshot, completeOnboarding, rpc, signup } from "./helpers";

test("keeps a connected screen across seal rotation and renews before its actual expiry", async ({
  page,
}, testInfo) => {
  const started = Date.now();
  await page.clock.install({ time: started });
  await signup(page, `screen-continuity-${started}@rakazo.test`, "password12", "Screen Continuity");
  await completeOnboarding(page);
  const botId = activeBotId(page);
  await rpc(page, "computer/boot", { botId });

  let issuedAt = started;
  let identity = "a".repeat(64);
  let reads = 0;
  let loads = 0;
  await page.route("https://screen.example/**", (route) => {
    loads++;
    return route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Test desktop</title><body style="margin:0;height:100vh;display:grid;place-items:center;background:white;color:black"><p>Desktop connected</p><script>document.body.dataset.instance = String(Math.random())</script></body>',
    });
  });
  await page.route("**/rpc/computer/screenUrl", (route) => {
    reads++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        json: {
          url: `https://screen.example/novnc/session/view/${issuedAt + 60 * 60_000}.fake-${issuedAt}-${identity}/embed.html#rakazoScreen=${identity}`,
        },
      }),
    });
  });

  const panel = page.getByTestId("side-panel");
  if ((await panel.getAttribute("data-panel")) !== "computer")
    await page.getByTitle("Agent computer").click();
  const iframe = panel.locator('iframe[title="Bot screen preview"]');
  await expect(iframe).toBeVisible();
  await expect(iframe.contentFrame().getByText("Desktop connected")).toBeVisible();
  await expect(iframe.contentFrame().locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  const firstUrl = await iframe.getAttribute("src");
  const firstInstance = await iframe.contentFrame().locator("body").getAttribute("data-instance");
  expect(loads).toBe(1);

  async function sendAndFinish() {
    const before = reads;
    await page.locator('textarea[name="chat-message"]').fill("Hello");
    await Promise.all([
      page.waitForResponse("**/rpc/threads/send"),
      page.getByRole("button", { name: "Send", exact: true }).click(),
    ]);
    await expect
      .poll(async () => (await rpc<{ run: unknown }>(page, "threads/get", { botId })).run)
      .toBeNull();
    await expect.poll(() => reads).toBeGreaterThan(before);
    // Let the completed RPC and React's state commit settle before checking navigation.
    await page.waitForTimeout(200);
  }

  issuedAt = started + 6 * 60_000;
  await page.clock.fastForward(6 * 60_000);
  await sendAndFinish();
  await expect(iframe).toHaveAttribute("src", firstUrl!);
  await expect(iframe.contentFrame().locator("body")).toHaveAttribute(
    "data-instance",
    firstInstance!,
  );
  expect(loads).toBe(1);
  await captureScreenshot(page, testInfo, "computer-screen-stable-after-long-turn");

  const beforeRenewal = reads;
  issuedAt = started + 55 * 60_000;
  await page.clock.fastForward(49 * 60_000);
  await expect.poll(() => reads).toBeGreaterThan(beforeRenewal);
  await expect(iframe).not.toHaveAttribute("src", firstUrl!);
  await expect(iframe.contentFrame().getByText("Desktop connected")).toBeVisible();
  expect(loads).toBe(2);

  const renewedUrl = await iframe.getAttribute("src");
  identity = "b".repeat(64);
  await sendAndFinish();
  await expect(iframe).not.toHaveAttribute("src", renewedUrl!);
  await expect(iframe).toHaveAttribute("src", new RegExp(`rakazoScreen=${identity}$`));
  expect(loads).toBe(3);
});
