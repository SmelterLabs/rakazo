import { ORPCError } from "@orpc/server";
import type { Actor, RoutineHistory, RoutineRun, RoutineRunCursor } from "@rakazo/contracts";
import type { PrismaClient } from "@rakazo/db";
import { Prisma } from "@rakazo/db";

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
      thread: { select: { groupId: true } },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 21,
  });
  const runs = rows.slice(0, 20);
  const last = runs.at(-1);
  const nextCursor =
    rows.length > 20 && last ? { id: last.id, createdAt: last.createdAt.toISOString() } : null;
  // One newest bot reply per run; silent runs stay linkless.
  const messages = runs.length
    ? await prisma.$queryRaw<Array<{ id: string; runId: string; threadId: string }>>(Prisma.sql`
        SELECT DISTINCT ON ("runId") id, "runId", "threadId"
        FROM messages
        WHERE "runId" IN (${Prisma.join(runs.map((run) => run.id))})
          AND "threadId" IN (${Prisma.join(runs.map((run) => run.threadId))})
          AND role = 'bot'
          AND EXISTS (
            SELECT 1
            FROM threads t
            WHERE t.id = messages."threadId"
              AND t."spaceId" = ${actor.spaceId}
              AND t."userId" = ${actor.userId}
          )
        ORDER BY "runId", "createdAt" DESC, id DESC
      `)
    : [];
  const replyByRun = new Map(messages.map((message) => [message.runId, message.id]));
  return {
    nextCursor,
    runs: runs.map((run) => ({
      id: run.id,
      botId: run.botId,
      groupId: run.thread.groupId,
      status: run.status as RoutineRun["status"],
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      completedAt: run.completedAt?.toISOString() ?? null,
      messageId: replyByRun.get(run.id) ?? null,
    })),
  };
}
