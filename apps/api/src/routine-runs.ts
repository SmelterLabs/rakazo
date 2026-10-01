import { ORPCError } from "@orpc/server";
import type { Actor, RoutineHistory, RoutineRun, RoutineRunCursor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";

export async function listRoutineRuns(
  prisma: PrismaClient,
  actor: Actor,
  routineId: string,
  before?: RoutineRunCursor,
): Promise<RoutineHistory> {
  const routine = await prisma.routine.findFirst({
    where: {
      id: routineId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      bot: { archivedAt: null },
    },
    select: { botId: true },
  });
  if (!routine) throw new ORPCError("NOT_FOUND");

  const rows = await prisma.run.findMany({
    where: {
      routineId,
      botId: routine.botId,
      spaceId: actor.spaceId,
      userId: actor.userId,
      ...(before
        ? {
            OR: [
              { createdAt: { lt: new Date(before.createdAt) } },
              { createdAt: new Date(before.createdAt), id: { lt: before.id } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      botId: true,
      threadId: true,
      status: true,
      createdAt: true,
      startedAt: true,
      completedAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
  });
  const runs = rows.slice(0, 20);
  const last = runs.at(-1);
  const nextCursor =
    rows.length > 20 && last ? { id: last.id, createdAt: last.createdAt.toISOString() } : null;
  // Routine runs can finish silently. A chat link is offered only when a message exists.
  const messages = runs.length
    ? await prisma.message.findMany({
        where: {
          runId: { in: runs.map((run) => run.id) },
          threadId: { in: runs.map((run) => run.threadId) },
          role: "bot",
          thread: { spaceId: actor.spaceId, userId: actor.userId },
        },
        select: { id: true, runId: true, threadId: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  return {
    nextCursor,
    runs: runs.map((run) => ({
      id: run.id,
      botId: run.botId,
      status: run.status as RoutineRun["status"],
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      messageId:
        messages.find((message) => message.runId === run.id && message.threadId === run.threadId)
          ?.id ?? null,
    })),
  };
}
