import { describe, expect, it } from "vitest";
import {
  buildApprovalAskBlock,
  MAX_SHARED_MEMORY_APPROVAL_CHARS,
  sharedMemoryProposalError,
} from "./approval-ask.js";

describe("buildApprovalAskBlock", () => {
  it("binds the approval to its effect and redacts secrets", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", body: "token-secret" },
      ["token-secret"],
    );

    expect(block).toMatchObject({
      kind: "ask",
      approvalEffectId: "effect-1",
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "always", label: "Always allow this tool" },
        { id: "deny", label: "Deny" },
      ],
    });
    expect(JSON.stringify(block)).not.toContain("token-secret");
  });

  it("bounds model-controlled summaries and details", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "destination.write",
      { title: "t".repeat(1_000), body: "b".repeat(10_000) },
      [],
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.text.length).toBeLessThanOrEqual(501);
    expect(block.detail?.length).toBeLessThanOrEqual(4_001);
  });

  it("includes an optional review reason as the first detail line", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "gmail_send_email",
      { to: "person@example.test", subject: "Hi" },
      [],
      { reviewReason: "Sends email outside the draft-only task." },
    );

    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail?.startsWith("Sends email outside the draft-only task.")).toBe(true);
    expect(block.detail).toContain("to: person@example.test");
  });

  it("uses a one-time create or cancel choice for a new security boundary", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "create_space",
      { name: "Customer support" },
      [],
    );

    expect(block).toMatchObject({
      kind: "ask",
      text: "Create space “Customer support”?",
      actions: [
        { id: "allow", label: "Create space", outcome: "created" },
        { id: "deny", label: "Cancel", outcome: "cancelled" },
      ],
    });
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail).toContain("stay separate from other spaces");
  });

  it("shows Allow once and Deny for shared memory, with the full document", () => {
    const content = "Printing: all print jobs go to Clyde.\n".repeat(20);
    const block = buildApprovalAskBlock(
      "effect-1",
      "save_shared_memory",
      { path: "MEMORY.md", content },
      [],
    );

    expect(block).toMatchObject({
      kind: "ask",
      text: "Review before saving shared memory “MEMORY.md”",
      detail: content,
      actions: [
        { id: "allow", label: "Allow once" },
        { id: "deny", label: "Deny" },
      ],
    });
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.actions?.some((action) => action.id === "always")).toBe(false);
  });

  it("redacts secrets in shared memory approval detail without truncating under the limit", () => {
    const content = `token-secret\n${"x".repeat(100)}`;
    const block = buildApprovalAskBlock(
      "effect-1",
      "save_shared_memory",
      { path: "MEMORY.md", content },
      ["token-secret"],
    );
    expect(block.kind).toBe("ask");
    if (block.kind !== "ask") throw new Error("expected ask block");
    expect(block.detail).not.toContain("token-secret");
    expect(block.detail?.endsWith("x".repeat(100))).toBe(true);
  });

  it("shows a shared memory save as a diff against the previous content", () => {
    const block = buildApprovalAskBlock(
      "effect-1",
      "save_shared_memory",
      { path: "MEMORY.md", content: "a\nc" },
      [],
      { previousContent: "a\nb" },
    );
    expect(block).toMatchObject({ detail: "  a\n- b\n+ c", detailFormat: "diff" });
  });
});

describe("sharedMemoryProposalError", () => {
  it("requires a path and rejects content that cannot fit on the card", () => {
    expect(sharedMemoryProposalError({ path: "  ", content: "ok" })).toBe("path is required");
    expect(sharedMemoryProposalError({ path: "MEMORY.md", content: "ok" })).toBeUndefined();
    expect(
      sharedMemoryProposalError({
        path: "MEMORY.md",
        content: "x".repeat(MAX_SHARED_MEMORY_APPROVAL_CHARS + 1),
      }),
    ).toMatch(/exceeds/);
  });
});
