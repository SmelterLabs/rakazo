import type { ModelBackupChoice, ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import { OPENAI_COMPATIBLE_PROVIDER_ID } from "@rakazo/contracts";

export type MobileConnectedBackupOption = ModelBackupChoice & {
  label: string;
  providerName: string;
};

export function mobileBackupChoiceKey(choice: ModelBackupChoice): string {
  return JSON.stringify([choice.provider, choice.modelId]);
}

export function connectedMobileBackupOptions(
  catalog: ModelCatalogEntry[],
  credentials: ModelCredential[],
): MobileConnectedBackupOption[] {
  const connected = new Set(credentials.map((credential) => credential.provider));
  const options: MobileConnectedBackupOption[] = [];
  for (const entry of catalog) {
    if (
      !connected.has(entry.provider) ||
      entry.provider === OPENAI_COMPATIBLE_PROVIDER_ID ||
      entry.placeholder
    ) {
      continue;
    }
    options.push({
      provider: entry.provider,
      modelId: entry.id,
      label: entry.label,
      providerName: entry.providerName ?? entry.provider,
    });
  }
  const compatible = credentials.find(
    (credential) =>
      credential.provider === OPENAI_COMPATIBLE_PROVIDER_ID && credential.modelId?.trim(),
  );
  if (compatible?.modelId) {
    const entry = catalog.find(
      (candidate) =>
        candidate.provider === OPENAI_COMPATIBLE_PROVIDER_ID && candidate.id === compatible.modelId,
    );
    options.push({
      provider: OPENAI_COMPATIBLE_PROVIDER_ID,
      modelId: compatible.modelId,
      label: entry?.label ?? compatible.modelId,
      providerName: entry?.providerName ?? OPENAI_COMPATIBLE_PROVIDER_ID,
    });
  }
  return options;
}

export function moveMobileBackupChoice(
  choices: ModelBackupChoice[],
  index: number,
  direction: -1 | 1,
): ModelBackupChoice[] {
  const target = index + direction;
  if (index < 0 || index >= choices.length || target < 0 || target >= choices.length)
    return choices;
  const next = [...choices];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

export function sameMobileBackupChoices(
  left: ModelBackupChoice[],
  right: ModelBackupChoice[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (choice, index) =>
        choice.provider === right[index]?.provider && choice.modelId === right[index]?.modelId,
    )
  );
}

export function mobileBackupScopeIsCurrent(input: {
  expectedUserId: string;
  expectedSpaceId: string;
  currentUserId: string;
  currentSpaceId: string;
  selectedSpaceId: string | null;
  requestGeneration: number;
  currentGeneration: number;
}): boolean {
  return (
    input.expectedUserId === input.currentUserId &&
    input.expectedSpaceId === input.currentSpaceId &&
    (input.selectedSpaceId === null || input.selectedSpaceId === input.expectedSpaceId) &&
    input.requestGeneration === input.currentGeneration
  );
}
