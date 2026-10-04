import { createHash, timingSafeEqual } from "node:crypto";
import { hasActiveComputerControl } from "@rakazo/adapters";
import type { ScreenCapabilityScope } from "@rakazo/core/node/screen-capability";
import {
  openScreenCapability,
  SCREEN_TARGET_ENDPOINT,
  sealScreenCapability,
} from "@rakazo/core/node/screen-capability";
import type { PrismaClient } from "@rakazo/db";
import type { Hono } from "hono";
import { requestBodyLimit } from "./request-body-limit.js";

const screenLinks = new Map<string, { url: string; issuedAt: number }>();
const MAX_SCREEN_LINKS = 1_024;
// Mobile re-reads after 50 minutes. Even a newly joined viewer receiving a
// cached one-hour link needs that full interval plus five minutes of slack.
const SCREEN_LINK_RENEW_MS = 5 * 60_000;

export function addScreenProxyCapability(
  url: string,
  secret: string,
  origin: string,
  scope: ScreenCapabilityScope,
  now = Date.now(),
) {
  // Local/desktop providers return non-http schemes (e.g. desktop://). Those never
  // traverse the web proxy, so seal only http(s) upstream URLs.
  const protocol = new URL(url).protocol;
  if (protocol !== "http:" && protocol !== "https:") return url;
  // Re-sealing an unchanged stream changes the iframe src and blanks a live viewer.
  // Include the exact provider target and all authorization scope, not just the bot:
  // recycled streams, lifecycle generations and control leases must replace the URL.
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        url,
        secret,
        origin,
        scope.botId,
        scope.computerId,
        scope.botGeneration,
        scope.computerGeneration,
        scope.controlLeaseId,
      ]),
    )
    .digest("hex");
  const held = screenLinks.get(key);
  if (held && now >= held.issuedAt && now - held.issuedAt < SCREEN_LINK_RENEW_MS) {
    screenLinks.delete(key);
    screenLinks.set(key, held);
    return held.url;
  }
  const sealed = sealScreenCapability(url, secret, origin, scope, now);
  screenLinks.delete(key);
  screenLinks.set(key, { url: sealed, issuedAt: now });
  if (screenLinks.size > MAX_SCREEN_LINKS) {
    screenLinks.delete(screenLinks.keys().next().value!);
  }
  return sealed;
}

export function mountScreenTarget(app: Hono, prisma: PrismaClient, secret: string) {
  app.post(SCREEN_TARGET_ENDPOINT, requestBodyLimit(16 * 1024), async (c) => {
    c.header("cache-control", "no-store");
    const supplied = Buffer.from(c.req.header("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      return c.body(null, 403);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.path !== "string") return c.body(null, 403);
    const capability = openScreenCapability(body.path, secret);
    if (!capability) return c.body(null, 403);
    const { scope, target } = capability;
    const bot = await prisma.bot.findFirst({
      where: {
        id: scope.botId,
        computerId: scope.computerId,
        archivedAt: null,
        screenGeneration: scope.botGeneration,
      },
      select: {
        computer: {
          select: {
            screenGeneration: true,
            providerRef: true,
            state: true,
            controlHolder: true,
            controlLeaseId: true,
            controlBotId: true,
            controlLeaseExpiresAt: true,
          },
        },
      },
    });
    const computer = bot?.computer;
    if (
      !computer ||
      computer.screenGeneration !== scope.computerGeneration ||
      !computer.providerRef ||
      !["running", "booting"].includes(computer.state) ||
      (target.interactive &&
        (!hasActiveComputerControl(computer) ||
          !scope.controlLeaseId ||
          computer.controlLeaseId !== scope.controlLeaseId ||
          computer.controlBotId !== scope.botId))
    )
      return c.body(null, 403);
    return c.json(target);
  });
}
