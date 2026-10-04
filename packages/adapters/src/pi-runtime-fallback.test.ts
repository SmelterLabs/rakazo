import type { AssistantMessage, CredentialStore, Model } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AgentRunRequest } from "@rakazo/adapter-kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const providerState = vi.hoisted(() => ({
  models: new Map<string, Record<string, unknown>>(),
  credentialStores: [] as unknown[],
  stream: vi.fn(),
}));

vi.mock("@earendil-works/pi-ai/providers/all", () => ({
  builtinModels: (options?: { credentials?: unknown }) => {
    if (options?.credentials) providerState.credentialStores.push(options.credentials);
    return {
      getModel: (provider: string, id: string) => providerState.models.get(`${provider}/${id}`),
      streamSimple: (...args: unknown[]) => providerState.stream(...args),
    };
  },
}));

vi.mock("./pi-current-models.js", () => ({ supplementPiModels: (models: unknown) => models }));
vi.mock("./pi-local-provider.js", () => ({ registerLocalProvider: (models: unknown) => models }));
vi.mock("./pi-openai-compatible-provider.js", () => ({
  OPENAI_COMPATIBLE_PROVIDER_ID: "openai-compatible",
  registerOpenAiCompatibleCatalog: (models: unknown) => models,
  registerOpenAiCompatibleRuntime: (models: unknown) => models,
}));

import { isRetryableProviderUnavailable, PiAgentRuntime } from "./pi-runtime.js";

const primary = model("provider-a", "primary", 32_768);
const backupA = model("provider-b", "backup-a", 8_192);
const backupB = model("provider-c", "backup-b", 16_384);

function model(provider: string, id: string, contextWindow: number): Model<"openai-completions"> {
  return {
    provider,
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://models.invalid/v1",
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow,
    maxTokens: Math.min(4_096, contextWindow),
  };
}

function message(
  target: Model<"openai-completions">,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: target.api,
    provider: target.provider,
    model: target.id,
    usage: {
      input: 4,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 6,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function stream(_target: Model<"openai-completions">, response: AssistantMessage) {
  const result = new AssistantMessageEventStream();
  result.push({ type: "start", partial: { ...response, content: [], stopReason: "stop" } });
  if (response.stopReason === "error" || response.stopReason === "aborted") {
    result.push({
      type: "error",
      reason: response.stopReason,
      error: response,
    });
  } else if (response.content.some((part) => part.type === "toolCall")) {
    const call = response.content.find((part) => part.type === "toolCall");
    if (call?.type === "toolCall") {
      result.push({
        type: "toolcall_start",
        contentIndex: 0,
        partial: { ...response, content: [] },
      });
      result.push({
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: call,
        partial: response,
      });
    }
    result.push({ type: "done", reason: "toolUse", message: response });
  } else {
    result.push({ type: "done", reason: "stop", message: response });
  }
  result.end(response);
  return result;
}

function request(fallbackModels: AgentRunRequest["model"][] = []): AgentRunRequest {
  return {
    botId: "bot",
    threadId: "thread",
    runId: "run",
    prompt: "Write the requested result",
    instructions: "Use tools when useful.",
    history: [],
    tools: [
      {
        name: "write_effect",
        description: "Write one external effect.",
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        readOnly: false,
      },
    ],
    model: { provider: primary.provider, id: primary.id, apiKey: "fake-primary-key" },
    fallbackModels,
    executeTool: vi.fn(async () => ({ ok: true })),
  } as unknown as AgentRunRequest;
}

async function run(input: AgentRunRequest) {
  const runtime = new PiAgentRuntime();
  const events = [];
  for await (const event of runtime.run(input, {
    operationId: "operation",
    traceId: "trace",
    spaceId: "space",
    userId: "user",
    signal: new AbortController().signal,
  })) {
    events.push(event);
  }
  return events;
}

beforeEach(() => {
  providerState.models.clear();
  providerState.credentialStores.length = 0;
  for (const candidate of [primary, backupA, backupB]) {
    providerState.models.set(
      `${candidate.provider}/${candidate.id}`,
      candidate as unknown as Record<string, unknown>,
    );
  }
  providerState.stream.mockReset();
});

describe("Pi runtime ordered model fallback", () => {
  it("continues after a long-retry 429 on a smaller backup without replaying a completed tool effect", async () => {
    const input = request([
      { provider: backupA.provider, id: backupA.id, apiKey: "fake-backup-a" },
    ]);
    const executeTool = vi.mocked(input.executeTool!);
    let primaryCalls = 0;
    let backupContext: { messages?: unknown[] } | undefined;
    providerState.stream.mockImplementation(
      (target: Model<"openai-completions">, context: { messages?: unknown[] }) => {
        if (target.provider === primary.provider) {
          primaryCalls += 1;
          if (primaryCalls === 1) {
            const call = {
              type: "toolCall" as const,
              id: "write-once",
              name: "write_effect",
              arguments: { value: "persist this once" },
            };
            return stream(target, message(target, [call], "toolUse"));
          }
          return stream(
            target,
            message(
              target,
              [],
              "error",
              "Server requested 3301s retry delay (max:60s). 429 rate_limit_error",
            ),
          );
        }
        backupContext = context;
        return stream(
          target,
          message(target, [{ type: "text", text: "Finished safely." }], "stop"),
        );
      },
    );

    const events = await run(input);

    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(primaryCalls).toBe(2);
    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider, primary.provider, backupA.provider]);
    expect(JSON.stringify(backupContext?.messages)).toContain("write-once");
    expect(events).toContainEqual(
      expect.objectContaining({ type: "text", text: "Finished safely." }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "usage", provider: backupA.provider, model: backupA.id }),
    );
  });

  it("keeps the primary on a healthy response and leaves an empty chain unchanged", async () => {
    providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
      stream(target, message(target, [{ type: "text", text: "Primary response." }], "stop")),
    );

    const events = await run(request());

    expect(providerState.stream).toHaveBeenCalledTimes(1);
    expect(providerState.stream.mock.calls[0]?.[0]).toMatchObject({ provider: primary.provider });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "usage", provider: primary.provider, model: primary.id }),
    );
  });

  it("keeps helper-model selection on the active backup after the primary fails", async () => {
    const input = request([
      { provider: backupA.provider, id: backupA.id, apiKey: "backup-fixture-key" },
    ]);
    input.model.apiKey = "primary-fixture-key";
    input.tools = [
      {
        name: "run_subagent",
        description: "Run a helper agent.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" }, task: { type: "string" } },
          required: ["name", "task"],
        },
        readOnly: true,
      },
    ];
    const providers: string[] = [];
    const apiKeys: Array<string | undefined> = [];
    let backupCalls = 0;
    providerState.stream.mockImplementation(
      (target: Model<"openai-completions">, _context: unknown, options?: { apiKey?: string }) => {
        providers.push(target.provider);
        apiKeys.push(options?.apiKey);
        if (target.provider === primary.provider) {
          return stream(target, message(target, [], "error", "429 rate_limit_error"));
        }
        backupCalls += 1;
        if (backupCalls === 1) {
          return stream(
            target,
            message(
              target,
              [
                {
                  type: "toolCall",
                  id: "helper-call",
                  name: "run_subagent",
                  arguments: { name: "helper", task: "Summarize the fixture." },
                },
              ],
              "toolUse",
            ),
          );
        }
        return stream(target, message(target, [{ type: "text", text: "Complete." }], "stop"));
      },
    );

    await run(input);

    expect(providers).toEqual([
      primary.provider,
      backupA.provider,
      backupA.provider,
      backupA.provider,
    ]);
    expect(apiKeys).toEqual([
      "primary-fixture-key",
      "backup-fixture-key",
      "backup-fixture-key",
      "backup-fixture-key",
    ]);
  });

  it("keeps a refreshed backup OAuth token for later helper calls", async () => {
    const input = request([{ provider: backupA.provider, id: backupA.id }]);
    input.tools = [
      {
        name: "run_subagent",
        description: "Run a helper agent.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" }, task: { type: "string" } },
          required: ["name", "task"],
        },
        readOnly: true,
      },
    ];
    input.resolveFallbackModel = vi.fn(async () => ({
      provider: backupA.provider,
      id: backupA.id,
      oauth: {
        credential: {
          type: "oauth" as const,
          access: "backup-access-before-refresh",
          refresh: "backup-refresh",
          expires: Date.now() + 60_000,
        },
      },
    }));
    const backupKeys: Array<string | undefined> = [];
    let backupCalls = 0;
    providerState.stream.mockImplementation(
      (target: Model<"openai-completions">, _context: unknown, options?: { apiKey?: string }) => {
        if (target.provider === primary.provider) {
          return stream(target, message(target, [], "error", "429 rate_limit_error"));
        }
        backupCalls += 1;
        backupKeys.push(options?.apiKey);
        if (backupCalls !== 1) {
          return stream(target, message(target, [{ type: "text", text: "Complete." }], "stop"));
        }
        const credentialStore = providerState.credentialStores[0] as CredentialStore;
        const response = message(
          target,
          [
            {
              type: "toolCall",
              id: "oauth-helper-call",
              name: "run_subagent",
              arguments: { name: "helper", task: "Summarize the fixture." },
            },
          ],
          "toolUse",
        );
        const output = new AssistantMessageEventStream();
        void (async () => {
          await credentialStore.modify(backupA.provider, async (current) => {
            if (current?.type !== "oauth") throw new Error("OAuth credential missing in fixture");
            return { ...current, access: "backup-access-after-refresh" };
          });
          for await (const event of stream(target, response)) output.push(event);
          output.end(response);
        })();
        return output;
      },
    );

    const events = await run(input);

    expect(backupKeys).toEqual([
      "backup-access-before-refresh",
      "backup-access-after-refresh",
      "backup-access-after-refresh",
    ]);
    expect(JSON.stringify(events)).not.toContain("backup-access-before-refresh");
    expect(JSON.stringify(events)).not.toContain("backup-access-after-refresh");
  });

  it("persists the selected model before streaming from the backup", async () => {
    const input = request([{ provider: backupA.provider, id: backupA.id, apiKey: "backup-key" }]);
    let modelChangePersisted = false;
    input.onModelChange = vi.fn(async () => {
      await Promise.resolve();
      modelChangePersisted = true;
    });
    providerState.stream.mockImplementation((target: Model<"openai-completions">) => {
      if (target.provider === primary.provider) {
        return stream(target, message(target, [], "error", "429 rate_limit_error"));
      }
      expect(modelChangePersisted).toBe(true);
      return stream(target, message(target, [{ type: "text", text: "backup response" }], "stop"));
    });

    const events = await run(input);

    expect(input.onModelChange).toHaveBeenCalledExactlyOnceWith(backupA.provider, backupA.id);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "progress",
        text: expect.stringContaining(backupA.id),
      }),
    );
  });

  it("does not switch after partial assistant output", async () => {
    const targetMessage = message(
      primary,
      [{ type: "text", text: "partial" }],
      "error",
      "429 rate_limit_error",
    );
    providerState.stream.mockImplementation((target: Model<"openai-completions">) => {
      if (target.provider === primary.provider) {
        const result = new AssistantMessageEventStream();
        const partial = { ...targetMessage, content: [] };
        result.push({ type: "start", partial });
        result.push({ type: "text_start", contentIndex: 0, partial });
        result.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "partial",
          partial: targetMessage,
        });
        result.push({ type: "error", reason: "error", error: targetMessage });
        result.end(targetMessage);
        return result;
      }
      return stream(target, message(target, [{ type: "text", text: "must not run" }], "stop"));
    });

    await expect(
      run(request([{ provider: backupA.provider, id: backupA.id, apiKey: "fake-backup-a" }])),
    ).rejects.toThrow(/429 rate_limit_error/);

    expect(providerState.stream).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: "text",
      content: [{ type: "text" as const, text: "terminal partial" }],
    },
    {
      label: "thinking",
      content: [{ type: "thinking" as const, thinking: "terminal reasoning" }],
    },
    {
      label: "tool call",
      content: [
        {
          type: "toolCall" as const,
          id: "terminal-call",
          name: "write_effect",
          arguments: { value: "must not execute" },
        },
      ],
    },
  ])(
    "does not switch when the terminal error contains partial $label without deltas",
    async ({ content, label }) => {
      const failure = message(primary, content, "error", "429 rate_limit_error");
      providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
        target.provider === primary.provider
          ? stream(target, failure)
          : stream(target, message(target, [{ type: "text", text: "must not run" }], "stop")),
      );
      const input = request([{ provider: backupA.provider, id: backupA.id, apiKey: "backup-key" }]);
      const events: Array<{ type: string; text?: string }> = [];
      const runtime = new PiAgentRuntime();
      const consume = async () => {
        for await (const event of runtime.run(input, {
          operationId: "operation",
          traceId: "trace",
          spaceId: "space",
          userId: "user",
          signal: new AbortController().signal,
        })) {
          events.push(event);
        }
      };

      await expect(consume()).rejects.toThrow(/429 rate_limit_error/);

      expect(providerState.stream).toHaveBeenCalledTimes(1);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "text", text: "terminal partial" }),
      );
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "text", text: "must not run" }),
      );
      expect(label).toBeTruthy();
    },
  );

  it("does not switch because a tool failed", async () => {
    const input = request([
      { provider: backupA.provider, id: backupA.id, apiKey: "fake-backup-a" },
    ]);
    input.executeTool = vi.fn(async () => {
      throw new Error("tool permission denied");
    });
    let primaryCalls = 0;
    providerState.stream.mockImplementation((target: Model<"openai-completions">) => {
      primaryCalls += 1;
      if (primaryCalls === 1) {
        const call = {
          type: "toolCall" as const,
          id: "failed-tool",
          name: "write_effect",
          arguments: { value: "denied" },
        };
        return stream(target, message(target, [call], "toolUse"));
      }
      return stream(
        target,
        message(target, [{ type: "text", text: "The tool was denied." }], "stop"),
      );
    });

    await run(input);

    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider, primary.provider]);
  });

  it("tries backups in order and each only once before surfacing exhaustion", async () => {
    providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
      stream(target, message(target, [], "error", "529 overloaded_error")),
    );

    await expect(
      run(
        request([
          { provider: primary.provider, id: primary.id, apiKey: "duplicate-primary" },
          { provider: backupA.provider, id: backupA.id, apiKey: "fake-backup-a" },
          { provider: backupA.provider, id: backupA.id, apiKey: "duplicate-backup" },
          { provider: backupB.provider, id: backupB.id, apiKey: "fake-backup-b" },
        ]),
      ),
    ).rejects.toThrow(/overloaded_error/);

    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider, backupA.provider, backupB.provider]);
  });

  it("skips a backup that cannot fit the actual prompt and selects the next smaller-than-primary fit", async () => {
    const input = request([
      { provider: backupA.provider, id: backupA.id, apiKey: "small...key" },
      { provider: backupB.provider, id: backupB.id, apiKey: "fitti...key" },
    ]);
    input.prompt = "x".repeat(40_000);
    providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
      target.provider === primary.provider
        ? stream(target, message(target, [], "error", "429 rate_limit_error"))
        : stream(target, message(target, [{ type: "text", text: "fit" }], "stop")),
    );

    await run(input);

    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider, backupB.provider]);
  });

  it("uses a small-context backup when the actual input and configured output fit", async () => {
    const smallContextBackup = model("provider-small", "small-context", 2_048);
    providerState.models.set(
      `${smallContextBackup.provider}/${smallContextBackup.id}`,
      smallContextBackup as unknown as Record<string, unknown>,
    );
    const input = request([
      {
        provider: smallContextBackup.provider,
        id: smallContextBackup.id,
        apiKey: "small...key",
        maxTokens: 512,
      },
    ]);
    providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
      target.provider === primary.provider
        ? stream(target, message(target, [], "error", "429 rate_limit_error"))
        : stream(target, message(target, [{ type: "text", text: "fits" }], "stop")),
    );

    await run(input);

    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider, smallContextBackup.provider]);
  });

  it("skips backups without the primary turn's reasoning capability", async () => {
    const reasoningPrimary = { ...primary, reasoning: true };
    const textOnlyBackup = { ...backupA, reasoning: false };
    const reasoningBackup = { ...backupB, reasoning: true };
    providerState.models.set(`${primary.provider}/${primary.id}`, reasoningPrimary);
    providerState.models.set(`${backupA.provider}/${backupA.id}`, textOnlyBackup);
    providerState.models.set(`${backupB.provider}/${backupB.id}`, reasoningBackup);
    const input = request([
      { provider: backupA.provider, id: backupA.id, apiKey: "text-only-key" },
      { provider: backupB.provider, id: backupB.id, apiKey: "reasoning-key" },
    ]);
    input.model.reasoning = true;
    input.model.thinkingLevel = "high";
    providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
      target.provider === primary.provider
        ? stream(target, message(target, [], "error", "429 rate_limit_error"))
        : stream(target, message(target, [{ type: "text", text: "reasoned" }], "stop")),
    );

    await run(input);

    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider, backupB.provider]);
  });

  it("skips backups that cannot accept the current image input", async () => {
    const textOnlyBackup = { ...backupA, input: ["text"] as ["text"] };
    providerState.models.set(`${backupA.provider}/${backupA.id}`, textOnlyBackup);
    const input = request([
      { provider: backupA.provider, id: backupA.id, apiKey: "text-only-key" },
      { provider: backupB.provider, id: backupB.id, apiKey: "image-backup-key" },
    ]);
    input.currentTurnImages = [
      { name: "fixture.png", mimeType: "image/png", data: new Uint8Array([1]) },
    ];
    providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
      target.provider === primary.provider
        ? stream(target, message(target, [], "error", "429 rate_limit_error"))
        : stream(target, message(target, [{ type: "text", text: "image understood" }], "stop")),
    );

    await run(input);

    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider, backupB.provider]);
  });

  it("does not persist or start a backup when cancellation wins during credential resolution", async () => {
    const input = request([{ provider: backupA.provider, id: backupA.id }]);
    let releaseResolution: ((model: AgentRunRequest["model"]) => void) | undefined;
    input.resolveFallbackModel = vi.fn(
      () =>
        new Promise<AgentRunRequest["model"]>((resolve) => {
          releaseResolution = resolve;
        }),
    );
    const onModelChange = vi.fn(async () => undefined);
    input.onModelChange = onModelChange;
    providerState.stream.mockImplementation((target: Model<"openai-completions">) =>
      stream(
        target,
        target.provider === primary.provider
          ? message(target, [], "error", "429 rate_limit_error")
          : message(target, [{ type: "text", text: "must not start" }], "stop"),
      ),
    );
    const controller = new AbortController();
    const runtime = new PiAgentRuntime();
    const consume = async () => {
      try {
        for await (const _event of runtime.run(input, {
          operationId: "operation",
          traceId: "trace",
          spaceId: "space",
          userId: "user",
          signal: controller.signal,
        })) {
          // Drain the runtime stream while cancellation is tested.
        }
      } catch {
        // Cancellation is surfaced as a stopped run by the outer runtime.
      }
    };
    const running = consume();
    await vi.waitFor(() => expect(input.resolveFallbackModel).toHaveBeenCalledOnce());
    controller.abort();
    releaseResolution?.({ provider: backupA.provider, id: backupA.id, apiKey: "test-backup-key" });
    await running;

    expect(onModelChange).not.toHaveBeenCalled();
    expect(
      providerState.stream.mock.calls.map(
        ([target]) => (target as Model<"openai-completions">).provider,
      ),
    ).toEqual([primary.provider]);
  });

  it("skips a backup with changed credentials and uses only the next backup's credential", async () => {
    const input = request([
      { provider: backupA.provider, id: backupA.id },
      { provider: backupB.provider, id: backupB.id },
    ]);
    const resolveFallbackModel = vi.fn(async (provider: string, id: string) => {
      if (provider === backupA.provider) throw new Error("connected credential changed");
      return { provider, id, apiKey: "backup-only-key" };
    });
    input.resolveFallbackModel = resolveFallbackModel;
    const requestKeys: Array<string | undefined> = [];
    providerState.stream.mockImplementation(
      (target: Model<"openai-completions">, _context: unknown, options?: { apiKey?: string }) => {
        if (target.provider === primary.provider) {
          return stream(target, message(target, [], "error", "429 rate_limit_error"));
        }
        requestKeys.push(options?.apiKey);
        return stream(target, message(target, [{ type: "text", text: "safe" }], "stop"));
      },
    );

    const events = await run(input);

    expect(resolveFallbackModel).toHaveBeenNthCalledWith(1, backupA.provider, backupA.id);
    expect(resolveFallbackModel).toHaveBeenNthCalledWith(2, backupB.provider, backupB.id);
    expect(requestKeys).toEqual(["backup-only-key"]);
    expect(JSON.stringify(events)).not.toContain("backup-only-key");
  });
});

describe("provider availability classification", () => {
  it.each([
    [
      "HTTP 400 before retry text",
      { status: 400, message: "429 rate limit; Retry-After 3301s" },
      false,
    ],
    [
      "HTTP 401 before retry text",
      { statusCode: 401, message: "429 rate limit; Retry-After 3301s" },
      false,
    ],
    [
      "HTTP 403 before retry text",
      { httpStatus: 403, message: "429 rate limit; Retry-After 3301s" },
      false,
    ],
    [
      "unprocessable input before retry text",
      { status: 422, message: "The request cannot be processed; 429 rate limit" },
      false,
    ],
    [
      "cancellation",
      new Error("user cancelled request; retry after 3301 seconds; 429 rate limit"),
      false,
    ],
    [
      "consent refusal",
      new Error("user declined consent; retry after 3301 seconds; 429 rate limit"),
      false,
    ],
    ["quota exhaustion", { status: 402, message: "provider quota exhausted" }, true],
    ["transient server failure", { status: 503, message: "service unavailable" }, true],
  ])("classifies %s", (_label, error, expected) => {
    expect(isRetryableProviderUnavailable(error)).toBe(expected);
  });
});
