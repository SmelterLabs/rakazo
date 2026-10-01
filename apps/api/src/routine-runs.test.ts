import type { Actor } from "@rakazo/contracts";
import { RoutineHistorySchema } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { describe, expect, it, vi } from "vitest";
import { listRoutineRuns } from "./routine-runs.js";

const actor: Actor = {
  userId: "user-1",
  spaceId: "space-1",
  email: "user@rakazo.test",
  isDeploymentOwner: false,
};
const at = new Date("2026-01-02T12:00:00Z");
function fixture() {
  const routine = vi.fn().mockResolvedValue({ botId: "bot-1" });
  const runs = vi.fn().mockResolvedValue([]);
  const queryRaw = vi.fn().mockResolvedValue([]);
  const prisma = {
    routine: { findFirst: routine },
    run: { findMany: runs },
    $queryRaw: queryRaw,
  } as unknown as PrismaClient;
  return { prisma, routine, runs, queryRaw };
}
describe("routine history", () => {
  it("refuses missing, foreign or archived routines before reading runs", async () => {
    const { prisma, routine, runs, queryRaw } = fixture();
    routine.mockResolvedValue(null);
    await expect(listRoutineRuns(prisma, actor, "routine-1")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(routine).toHaveBeenCalledWith({
      where: {
        id: "routine-1",
        spaceId: actor.spaceId,
        userId: actor.userId,
        bot: { archivedAt: null },
      },
      select: { botId: true },
    });
    expect(runs).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it("returns a bounded, newest-first history including silent, failed and queued runs", async () => {
    const { prisma, runs, queryRaw } = fixture();
    runs.mockResolvedValue(
      ["completed", "failed", "queued"].map((status, i) => ({
        id: `run-${i}`,
        botId: "bot-1",
        threadId: "thread-1",
        status,
        createdAt: at,
        startedAt: status === "queued" ? null : at,
        completedAt: status === "queued" ? null : new Date(at.getTime() + 82_000),
        thread: { groupId: i === 1 ? "group-1" : null },
      })),
    );
    queryRaw.mockResolvedValue([{ id: "reply-new", runId: "run-1", threadId: "thread-1" }]);
    const history = await listRoutineRuns(prisma, actor, "routine-1");
    expect(RoutineHistorySchema.parse(history)).toEqual(history);
    expect(history.runs.map((row) => row.messageId)).toEqual([null, "reply-new", null]);
    expect(history.runs.map((row) => row.groupId)).toEqual([null, "group-1", null]);
    expect(history.runs[2]?.startedAt).toBeNull();
    expect(runs).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          routineId: "routine-1",
          botId: "bot-1",
          spaceId: actor.spaceId,
          userId: actor.userId,
        },
        take: 21,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: expect.objectContaining({
          thread: { select: { groupId: true } },
        }),
      }),
    );
    expect(queryRaw).toHaveBeenCalledOnce();
  });
  it("does not confuse a database failure with an empty history", async () => {
    const { prisma, runs, queryRaw } = fixture();
    runs.mockRejectedValue(new Error("database unavailable"));
    await expect(listRoutineRuns(prisma, actor, "routine-1")).rejects.toThrow(
      "database unavailable",
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it("skips the message query when the routine has never run", async () => {
    const { prisma, queryRaw } = fixture();
    await expect(listRoutineRuns(prisma, actor, "routine-1")).resolves.toEqual({
      runs: [],
      nextCursor: null,
    });
    expect(queryRaw).not.toHaveBeenCalled();
  });
  it("pages all history using stable timestamp/id boundaries without including the lookahead row", async () => {
    const { prisma, runs } = fixture();
    runs.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({
        id: `run-${String(30 - i).padStart(2, "0")}`,
        botId: "bot-1",
        threadId: "thread-1",
        status: "completed",
        createdAt: at,
        startedAt: at,
        completedAt: at,
        thread: { groupId: null },
      })),
    );
    const first = await listRoutineRuns(prisma, actor, "routine-1");
    expect(first.runs).toHaveLength(20);
    expect(first.nextCursor).toEqual({ id: "run-11", createdAt: at.toISOString() });
    runs.mockResolvedValue([]);
    const next = await listRoutineRuns(prisma, actor, "routine-1", first.nextCursor!);
    expect(next).toEqual({ runs: [], nextCursor: null });
    expect(runs).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          routineId: "routine-1",
          botId: "bot-1",
          spaceId: actor.spaceId,
          userId: actor.userId,
          OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: "run-11" } }],
        },
      }),
    );
  });
});
