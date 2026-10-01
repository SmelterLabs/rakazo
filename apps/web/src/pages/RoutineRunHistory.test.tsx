// @vitest-environment jsdom
import type { RoutineRun } from "@rakazo/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock("../lib/rpc", () => ({ rpc: { routines: api } }));
vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray) => parts.join(""),
}));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ i18n: { locale: "en" } }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@rakazo/ui-web", () => ({
  Button: ({
    size: _size,
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { size?: string; variant?: string }) => <button {...props} />,
}));

import { RoutineRunHistory } from "./RoutineRunHistory";

const run: RoutineRun = {
  id: "run-1",
  botId: "bot-1",
  groupId: null,
  status: "completed",
  createdAt: "2026-01-02T12:00:00Z",
  startedAt: "2026-01-02T12:00:00Z",
  completedAt: "2026-01-02T12:01:22Z",
  messageId: "reply-1",
};
const page = (runs: RoutineRun[]) => ({ runs, nextCursor: null });
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  api.history.mockReset();
});
async function mounted(routineId = "routine-1") {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (id: string) =>
    act(async () =>
      root.render(
        <MemoryRouter>
          <RoutineRunHistory key={id} routineId={id} />
        </MemoryRouter>,
      ),
    );
  await render(routineId);
  return {
    container,
    render,
    close: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
it("shows loading, then the real run and its exact message link", async () => {
  let finish!: (rows: RoutineRun[]) => void;
  api.history.mockReturnValue(
    new Promise<RoutineRun[]>((resolve) => {
      finish = resolve;
    }).then(page),
  );
  const view = await mounted();
  try {
    expect(view.container.textContent).toContain("Loading");
    expect(view.container.textContent).not.toContain("No runs yet");
    await act(async () => finish([run]));
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(view.container.textContent).toContain("1m 22s");
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe("/app/bot-1?m=reply-1");
  } finally {
    await view.close();
  }
});
it("shows a genuine empty state and refreshes while the panel is open", async () => {
  vi.useFakeTimers();
  api.history
    .mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([{ ...run, messageId: null }]));
  const view = await mounted();
  try {
    expect(view.container.textContent).toContain("No runs yet");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(view.container.querySelector("a")).toBeNull();
    await view.close();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.history).toHaveBeenCalledTimes(2);
  } catch (error) {
    await view.close();
    throw error;
  }
});
it("shows failures honestly, preserves previous results and recovers on the next refresh", async () => {
  vi.useFakeTimers();
  api.history
    .mockResolvedValueOnce(page([run]))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(page([]));
  const view = await mounted();
  try {
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(view.container.textContent).not.toContain("No runs yet");
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(view.container.querySelector('[role="alert"]')).toBeNull();
    expect(view.container.textContent).toContain("No runs yet");
  } finally {
    await view.close();
  }
});
it("discards a response from the previous routine", async () => {
  let finish!: (rows: RoutineRun[]) => void;
  api.history
    .mockReturnValueOnce(
      new Promise<RoutineRun[]>((resolve) => {
        finish = resolve;
      }).then(page),
    )
    .mockResolvedValueOnce(page([]));
  const view = await mounted();
  try {
    await view.render("routine-2");
    await act(async () => finish([run]));
    expect(view.container.textContent).toContain("No runs yet");
    expect(view.container.querySelectorAll("li")).toHaveLength(0);
  } finally {
    await view.close();
  }
});
it("defaults to the latest run, expands all entries, and loads older pages", async () => {
  vi.useFakeTimers();
  const older = { ...run, id: "older", messageId: "older-reply" };
  const cursor = { id: "run-1", createdAt: run.createdAt };
  api.history.mockImplementation(async (input: { before?: unknown }) =>
    input.before
      ? page([{ ...older, id: "oldest", messageId: null }])
      : { runs: [run, older], nextCursor: cursor },
  );
  const view = await mounted();
  const button = (name: string) =>
    [...view.container.querySelectorAll("button")].find((b) => b.textContent === name)!;
  try {
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    expect(button("Run history").getAttribute("aria-expanded")).toBe("false");
    await act(async () => button("Run history").click());
    expect(button("Run history").getAttribute("aria-expanded")).toBe("true");
    expect(view.container.querySelectorAll("li")).toHaveLength(2);
    await act(async () => button("Load older runs").click());
    expect(api.history).toHaveBeenLastCalledWith({ routineId: "routine-1", before: cursor });
    expect(view.container.querySelectorAll("li")).toHaveLength(3);
    expect(view.container.textContent).not.toContain("Load older runs");
    await act(async () => button("Run history").click());
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
    const requests = api.history.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(api.history).toHaveBeenCalledTimes(requests + 1);
    await act(async () => button("Run history").click());
    expect(view.container.querySelectorAll("li")).toHaveLength(3);
    expect(api.history).toHaveBeenCalledTimes(requests + 1);
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(api.history).toHaveBeenCalledTimes(requests + 1);
  } finally {
    await view.close();
  }
});
it("links a group reply to the group chat", async () => {
  api.history.mockResolvedValue(page([{ ...run, groupId: "group-1" }]));
  const view = await mounted();
  try {
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe(
      "/app/g/group-1?m=reply-1",
    );
  } finally {
    await view.close();
  }
});
