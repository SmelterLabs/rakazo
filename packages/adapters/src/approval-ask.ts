import type { MessageBlock } from "@rakazo/contracts";
import {
  formatLineDiff,
  lineDiff,
  redactSecrets,
  toolRequiresExplicitApproval,
} from "@rakazo/core";

const MAX_APPROVAL_SUMMARY_LENGTH = 500;
export const MAX_APPROVAL_DETAIL_LENGTH = 4_000;
/** Shared-memory cards must show the full document; larger proposals are rejected. */
export const MAX_SHARED_MEMORY_APPROVAL_CHARS = MAX_APPROVAL_DETAIL_LENGTH;

export function buildApprovalAskBlock(
  effectId: string,
  toolName: string,
  args: Record<string, unknown>,
  secrets: string[],
  options?: { reviewReason?: string; previousContent?: string },
): MessageBlock {
  const summary = describeApprovalAction(toolName, args);
  const diff = toolName === "save_shared_memory" && options?.previousContent !== undefined;
  const detail = diff
    ? formatLineDiff(lineDiff(options.previousContent!, String(args.content ?? "")))
    : formatApprovalDetail(toolName, args, options?.reviewReason);
  const safeDetail = detail ? redactSecrets(detail, secrets) : undefined;
  return {
    kind: "ask",
    approvalEffectId: effectId,
    text: truncate(
      redactSecrets(
        toolName === "create_space" ? `${summary}?` : `Review before ${summary}`,
        secrets,
      ),
      MAX_APPROVAL_SUMMARY_LENGTH,
    ),
    detail: safeDetail
      ? toolName === "save_shared_memory"
        ? safeDetail
        : truncate(safeDetail, MAX_APPROVAL_DETAIL_LENGTH)
      : undefined,
    ...(diff && safeDetail ? { detailFormat: "diff" as const } : {}),
    status: "pending",
    actions:
      toolName === "create_space"
        ? [
            { id: "allow", label: "Create space", outcome: "created" },
            { id: "deny", label: "Cancel", outcome: "cancelled" },
          ]
        : toolRequiresExplicitApproval(toolName)
          ? [
              { id: "allow", label: "Allow once" },
              { id: "deny", label: "Deny" },
            ]
          : [
              { id: "allow", label: "Allow once" },
              { id: "always", label: "Always allow this tool" },
              { id: "deny", label: "Deny" },
            ],
  };
}

export function sharedMemoryProposalError(args: Record<string, unknown>): string | undefined {
  const path = String(args.path ?? "").trim();
  if (!path) return "path is required";
  const content = String(args.content ?? "");
  if (content.length > MAX_SHARED_MEMORY_APPROVAL_CHARS) {
    return `content exceeds ${MAX_SHARED_MEMORY_APPROVAL_CHARS} characters; shorten it so the full document fits on the approval card`;
  }
  return undefined;
}

function describeApprovalAction(toolName: string, args: Record<string, unknown>): string {
  if (toolName === "destination.write") {
    const collection = args.collection ? String(args.collection) : "records";
    const title = args.title ? ` "${String(args.title)}"` : "";
    return `writing${title} to ${collection}`;
  }
  if (toolName === "delete_bot" || toolName === "archive_bot") {
    const name = args.confirm_name ?? args.confirmName;
    return name ? `${toolName.replace("_", " ")} (${String(name)})` : toolName.replace("_", " ");
  }
  if (toolName === "create_space") {
    const name = args.name ? String(args.name) : "Untitled";
    return `Create space “${name}”`;
  }
  if (toolName === "save_shared_memory") {
    return `saving shared memory “${String(args.path ?? "")}”`;
  }
  const target = pickScopeLabel(args);
  return target ? `${toolName} → ${target}` : toolName;
}

function formatApprovalDetail(
  toolName: string,
  args: Record<string, unknown>,
  reviewReason?: string,
): string | undefined {
  const lines: string[] = [];
  if (reviewReason?.trim()) {
    lines.push(reviewReason.trim().replace(/\u2014|\u2013/g, "-"));
  }
  if (toolName === "create_space") {
    lines.push(
      "Bots, groups, chats, files, memory, and integrations in this space stay separate from other spaces.",
    );
  }
  if (toolName === "save_shared_memory") {
    lines.push(String(args.content ?? ""));
  }
  for (const key of ["collection", "title", "to", "subject", "amount", "body"]) {
    const value = args[key];
    if (value == null || value === "") continue;
    lines.push(`${key}: ${String(value)}`);
  }
  if (lines.length === 0) return undefined;
  return lines.join("\n");
}

function pickScopeLabel(args: Record<string, unknown>): string | undefined {
  for (const key of ["to", "title", "collection", "subject", "amount"]) {
    const value = args[key];
    if (value != null && value !== "") return String(value);
  }
  return undefined;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
