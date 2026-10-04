import type { ModelBackupChoice, ModelCatalogEntry, ModelCredential } from "@rakazo/contracts";
import { describe, expect, it } from "vitest";
import {
  connectedMobileBackupOptions,
  mobileBackupScopeIsCurrent,
  moveMobileBackupChoice,
} from "./model-backups";

const catalog: ModelCatalogEntry[] = [
  { provider: "anthropic", providerName: "Anthropic", id: "sonnet", label: "Sonnet", billing: "" },
  { provider: "anthropic", providerName: "Anthropic", id: "haiku", label: "Haiku", billing: "" },
  { provider: "other", id: "other-model", label: "Other", billing: "" },
  { provider: "anthropic", id: "placeholder", label: "Anthropic", billing: "", placeholder: true },
  { provider: "openai-compatible", id: "server-model", label: "Server model", billing: "" },
];
const credentials: ModelCredential[] = [
  {
    id: "anthropic-credential",
    provider: "anthropic",
    label: "Anthropic",
    hasKey: true,
    isDefault: false,
  },
  {
    id: "compatible-credential",
    provider: "openai-compatible",
    label: "Private endpoint",
    hasKey: true,
    isDefault: false,
    modelId: "custom-model",
  },
];
const choices: ModelBackupChoice[] = [
  { provider: "anthropic", modelId: "sonnet" },
  { provider: "anthropic", modelId: "haiku" },
];

describe("mobile backup model helpers", () => {
  it("uses only connected catalog models and the configured OpenAI-compatible model", () => {
    expect(connectedMobileBackupOptions(catalog, credentials)).toEqual([
      { provider: "anthropic", modelId: "sonnet", label: "Sonnet", providerName: "Anthropic" },
      { provider: "anthropic", modelId: "haiku", label: "Haiku", providerName: "Anthropic" },
      {
        provider: "openai-compatible",
        modelId: "custom-model",
        label: "custom-model",
        providerName: "openai-compatible",
      },
    ]);
  });

  it("reorders without mutating and rejects stale user or Space responses", () => {
    expect(moveMobileBackupChoice(choices, 1, -1)).toEqual([choices[1], choices[0]]);
    expect(choices[0]?.modelId).toBe("sonnet");
    const validScope = {
      expectedUserId: "user-a",
      expectedSpaceId: "space-a",
      currentUserId: "user-a",
      currentSpaceId: "space-a",
      selectedSpaceId: "space-a",
      requestGeneration: 4,
      currentGeneration: 4,
    };
    expect(mobileBackupScopeIsCurrent(validScope)).toBe(true);
    expect(mobileBackupScopeIsCurrent({ ...validScope, selectedSpaceId: "space-b" })).toBe(false);
    expect(mobileBackupScopeIsCurrent({ ...validScope, currentUserId: "user-b" })).toBe(false);
    expect(mobileBackupScopeIsCurrent({ ...validScope, requestGeneration: 3 })).toBe(false);
  });
});
