// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const { bots, client } = vi.hoisted(() => {
  const bots = { list: vi.fn(), update: vi.fn() };
  return { bots, client: { bots } };
});

vi.mock("../../lib/space-rpc", () => ({ useSpaceRpc: () => client }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join("") }),
  Trans: ({ children }: { children?: ReactNode }) => children,
  Plural: ({ one, other, value }: { one: string; other: string; value: number }) =>
    (value === 1 ? one : other).replace("#", String(value)),
}));

import { botsWithOwnModel, SpaceBotsModelNotice } from "./space-bots-model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

it("counts only bots that pick both a provider and a model", () => {
  expect(
    botsWithOwnModel([
      { modelProvider: "anthropic", modelId: "claude-opus-5-5" },
      { modelProvider: null, modelId: null },
      { modelProvider: "openai-codex", modelId: null },
    ]),
  ).toHaveLength(1);
});

it("moves every bot with its own model onto the space model", async () => {
  const list = [
    { id: "b1", name: "Archie", modelProvider: "anthropic", modelId: "claude-sonnet-5-5" },
    { id: "b2", name: "Scout", modelProvider: null, modelId: null },
    { id: "b3", name: "Inbox", modelProvider: "anthropic", modelId: "claude-opus-5-5" },
  ];
  bots.list
    .mockResolvedValueOnce(list)
    .mockResolvedValue(list.map((bot) => ({ ...bot, modelProvider: null, modelId: null })));
  bots.update.mockResolvedValue({});
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SpaceBotsModelNotice />);
  });
  expect(host.textContent).toContain("2 bots pick their own model");
  expect(host.textContent).toContain("Archie, Inbox");
  const button = [...host.querySelectorAll("button")].find((node) =>
    node.textContent?.includes("Use the space model for all 2 bots"),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
  expect(bots.update).toHaveBeenCalledTimes(2);
  expect(bots.update).toHaveBeenCalledWith({
    botId: "b1",
    modelProvider: null,
    modelId: null,
    thinkingLevel: null,
  });
  expect(bots.update).toHaveBeenCalledWith(expect.objectContaining({ botId: "b3" }));
  expect(host.textContent).toContain("2 bots now follow the space model.");
  expect(host.querySelector("button")).toBeNull();
  act(() => root.unmount());
});

it("shows nothing when every bot already follows the space model", async () => {
  bots.list.mockResolvedValue([{ id: "b2", name: "Scout", modelProvider: null, modelId: null }]);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<SpaceBotsModelNotice />);
  });
  expect(host.textContent).toBe("");
  act(() => root.unmount());
});
