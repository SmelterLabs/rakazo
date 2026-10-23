import { t } from "@lingui/core/macro";
import type { ModelCatalogEntry } from "@rakazo/contracts";

/** Localize known provider auth hint fallbacks; pass through catalog `authHint` as-is. */
export function localizedProviderHint(entry: ModelCatalogEntry): string {
  if (entry.authHint) return entry.authHint;
  if (entry.signIn !== undefined) return t`Sign in`;
  if (entry.auth === "oauth") return t`Skip or deploy key`;
  return t`API key`;
}

/**
 * Name subscription connections by the plan people pay for. "OpenAI Codex" is the
 * ChatGPT subscription, and Anthropic signed in with OAuth is the Claude subscription.
 */
export function providerDisplayName(
  providerId: string,
  name: string,
  authKind?: string | null,
): string {
  if (providerId === "openai-codex") return t`ChatGPT subscription`;
  if (providerId === "anthropic" && authKind === "oauth") return t`Claude subscription`;
  return name;
}

/**
 * The provider-row subtitle, shown only when a provider is the exception:
 * sign-in, subscription, or custom-server auth. Plain API-key providers get none.
 */
export function providerRowHint(entry: ModelCatalogEntry): string | null {
  if (!entry.authHint && entry.signIn === undefined && entry.auth !== "oauth") return null;
  return localizedProviderHint(entry);
}
