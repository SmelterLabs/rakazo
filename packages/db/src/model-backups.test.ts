import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "./client.js";
import { listSpaceBackupModels, replaceSpaceBackupModels } from "./model-backups.js";

const scope = { userId: "user-a", spaceId: "space-one" };

describe("space backup models", () => {
  it("retries concurrent serialization conflicts with serializable replacement", async () => {
    const tx = { spaceBackupModel: { deleteMany: vi.fn(), createMany: vi.fn() } };
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementation(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
    await replaceSpaceBackupModels(
      { $transaction: transaction } as unknown as PrismaClient,
      scope,
      [],
    );
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });

  it("reads the persisted order only inside the current user and Space", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { provider: "provider-b", modelId: "model-b" },
      { provider: "provider-c", modelId: "model-c" },
    ]);
    const prisma = { spaceBackupModel: { findMany } } as unknown as PrismaClient;

    await expect(listSpaceBackupModels(prisma, scope)).resolves.toEqual([
      { provider: "provider-b", modelId: "model-b" },
      { provider: "provider-c", modelId: "model-c" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: scope.userId, spaceId: scope.spaceId },
      orderBy: { position: "asc" },
      select: { provider: true, modelId: true },
    });
  });

  it("replaces one Space's list atomically and assigns contiguous positions", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = { spaceBackupModel: { deleteMany, createMany } };
    const transaction = vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
    const prisma = { ...tx, $transaction: transaction } as unknown as PrismaClient;

    await replaceSpaceBackupModels(prisma, scope, [
      { provider: "provider-b", modelId: "model-b" },
      { provider: "provider-c", modelId: "model-c" },
    ]);

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: scope });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { ...scope, provider: "provider-b", modelId: "model-b", position: 0 },
        { ...scope, provider: "provider-c", modelId: "model-c", position: 1 },
      ],
    });
  });

  it("clears only the scoped list when the user saves no backups", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const createMany = vi.fn();
    const tx = { spaceBackupModel: { deleteMany, createMany } };
    const transaction = vi.fn(async (work: (client: typeof tx) => Promise<unknown>) => work(tx));
    const prisma = { ...tx, $transaction: transaction } as unknown as PrismaClient;

    await replaceSpaceBackupModels(prisma, { userId: "user-b", spaceId: "space-two" }, []);

    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: "user-b", spaceId: "space-two" } });
    expect(createMany).not.toHaveBeenCalled();
  });
});
