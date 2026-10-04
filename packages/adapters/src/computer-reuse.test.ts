import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterContext, JobPublisher, SandboxProvider } from "@rakazo/adapter-kit";
import type { PrismaClient, ThreadEvents } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { provisionComputer } from "./computer-lifecycle.js";
import { LocalAgentHomeStore } from "./home.js";

const context = {
  operationId: "reuse-test",
  traceId: "reuse-test",
  spaceId: "space",
  userId: "user",
  botId: "bot",
  signal: new AbortController().signal,
} satisfies AdapterContext;

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "rakazo-live-reuse-"));
  const row = {
    id: "computer",
    homeKey: "bot",
    providerRef: "provider",
    kind: "docker",
    scope: "dedicated",
    state: "running",
    screenGeneration: 7,
    maintenanceId: null,
    controlLeaseId: null,
    updatedAt: new Date("2024-01-01T00:00:00Z"),
  };
  const updateMany = vi.fn(async ({ where, data }) => {
    if (
      (where.state && where.state !== row.state) ||
      (where.providerRef && where.providerRef !== row.providerRef) ||
      (where.screenGeneration !== undefined && where.screenGeneration !== row.screenGeneration) ||
      (where.maintenanceId !== undefined && where.maintenanceId !== row.maintenanceId)
    )
      return { count: 0 };
    // Match the real database revocation trigger: entering booting revokes old URLs.
    if (
      data.state &&
      data.state !== row.state &&
      !(row.state === "booting" && data.state === "running")
    ) {
      row.screenGeneration++;
    }
    Object.assign(row, data);
    return { count: 1 };
  });
  const prisma = {
    computer: { findUniqueOrThrow: vi.fn(async () => ({ ...row })), updateMany },
  } as unknown as PrismaClient;
  const sandbox = {
    isRunning: vi.fn().mockResolvedValue(true),
    provision: vi.fn().mockResolvedValue({
      id: "provider",
      botId: "bot",
      kind: "docker",
      providerRef: "provider",
      fresh: false,
    }),
    prepare: vi.fn().mockResolvedValue(undefined),
    execute: vi.fn(async function* () {
      yield { type: "exit", code: 0 };
    }),
  };
  const deps = {
    prisma,
    sandbox: sandbox as unknown as SandboxProvider,
    home: new LocalAgentHomeStore(directory),
    jobs: {} as JobPublisher,
    events: {} as ThreadEvents,
    dataDir: directory,
  };
  return {
    row,
    sandbox,
    updateMany,
    deps,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

describe("reuse a verified running computer", () => {
  it("keeps the viewer authorization generation unchanged when another turn starts", async () => {
    const f = await fixture();
    try {
      const ref = await provisionComputer(f.deps, "computer", context, "bot");
      expect(ref).toMatchObject({ id: "provider", providerRef: "provider", kind: "docker" });
      expect(f.row.screenGeneration).toBe(7);
      expect(f.row.state).toBe("running");
      expect(f.sandbox.isRunning).toHaveBeenCalledOnce();
      expect(f.sandbox.provision).not.toHaveBeenCalled();
      expect(f.sandbox.prepare).toHaveBeenCalledOnce();
    } finally {
      await f.cleanup();
    }
  });

  it.each(["not-running", "no-probe", "stopped"])(
    "keeps the recovery path for %s computers",
    async (condition) => {
      const f = await fixture();
      try {
        if (condition === "not-running") f.sandbox.isRunning.mockResolvedValue(false);
        if (condition === "no-probe") delete f.deps.sandbox.isRunning;
        if (condition === "stopped") f.row.state = "stopped";
        await provisionComputer(f.deps, "computer", context, "bot");
        expect(f.sandbox.provision).toHaveBeenCalledOnce();
        expect(f.row.screenGeneration).toBe(8);
        if (condition === "stopped") expect(f.sandbox.isRunning).not.toHaveBeenCalled();
      } finally {
        await f.cleanup();
      }
    },
  );

  it.each(["state", "provider", "generation", "maintenance"])(
    "rejects a %s change during the live probe",
    async (change) => {
      const f = await fixture();
      try {
        f.sandbox.isRunning.mockImplementation(async () => {
          if (change === "state") f.row.state = "stopped";
          if (change === "provider") f.row.providerRef = "replacement";
          if (change === "generation") f.row.screenGeneration++;
          if (change === "maintenance") Object.assign(f.row, { maintenanceId: "updating" });
          return true;
        });
        await expect(provisionComputer(f.deps, "computer", context, "bot")).rejects.toThrow(
          "Computer is busy",
        );
        expect(f.sandbox.provision).not.toHaveBeenCalled();
        expect(f.sandbox.prepare).not.toHaveBeenCalled();
      } finally {
        await f.cleanup();
      }
    },
  );

  it("retains the active bot ownership predicate after a live probe", async () => {
    const f = await fixture();
    try {
      f.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(provisionComputer(f.deps, "computer", context, "bot")).rejects.toThrow(
        "Computer is busy",
      );
      expect(f.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ bots: { some: { id: "bot", archivedAt: null } } }),
        }),
      );
      expect(f.sandbox.prepare).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  it("still prepares the bot's Team workspace without a lifecycle transition", async () => {
    const f = await fixture();
    try {
      f.row.scope = "team";
      await provisionComputer(f.deps, "computer", context, "bot");
      expect(f.sandbox.execute).toHaveBeenCalledOnce();
      expect(f.row.screenGeneration).toBe(7);
      expect(f.sandbox.provision).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  it("does not recover or revoke a healthy reference when setup fails", async () => {
    const f = await fixture();
    try {
      f.sandbox.prepare.mockRejectedValue(new Error("setup failed"));
      await expect(provisionComputer(f.deps, "computer", context, "bot")).rejects.toThrow(
        "setup failed",
      );
      expect(f.row.screenGeneration).toBe(7);
      expect(f.sandbox.provision).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });

  it("does not adopt a live reference after cancellation", async () => {
    const f = await fixture();
    const abort = new AbortController();
    try {
      f.sandbox.isRunning.mockImplementation(async () => {
        abort.abort(new Error("cancelled"));
        return true;
      });
      await expect(
        provisionComputer(f.deps, "computer", { ...context, signal: abort.signal }, "bot"),
      ).rejects.toThrow("cancelled");
      expect(f.updateMany).not.toHaveBeenCalled();
      expect(f.sandbox.prepare).not.toHaveBeenCalled();
    } finally {
      await f.cleanup();
    }
  });
});
