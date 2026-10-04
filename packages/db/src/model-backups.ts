import type { ModelBackupChoice } from "@rakazo/contracts";
import type { PrismaClient } from "./client.js";
import { withTransactionRetry } from "./transaction-retry.js";

type BackupModelScope = { userId: string; spaceId: string };

export async function listSpaceBackupModels(
  prisma: Pick<PrismaClient, "spaceBackupModel">,
  scope: BackupModelScope,
): Promise<ModelBackupChoice[]> {
  const scoped = { userId: scope.userId, spaceId: scope.spaceId };
  return prisma.spaceBackupModel.findMany({
    where: scoped,
    orderBy: { position: "asc" },
    select: { provider: true, modelId: true },
  });
}

export async function replaceSpaceBackupModels(
  prisma: Pick<PrismaClient, "$transaction">,
  scope: BackupModelScope,
  models: ModelBackupChoice[],
): Promise<void> {
  const scoped = { userId: scope.userId, spaceId: scope.spaceId };
  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.spaceBackupModel.deleteMany({ where: scoped });
        if (models.length === 0) return;
        await tx.spaceBackupModel.createMany({
          data: models.map((model, position) => ({ ...scoped, ...model, position })),
        });
      },
      { isolationLevel: "Serializable" },
    ),
  );
}
