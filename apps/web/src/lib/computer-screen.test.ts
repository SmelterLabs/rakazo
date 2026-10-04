import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyComputerScreenRefresh,
  embeddableScreenUrl,
  loadComputerScreen,
  retainComputerScreenSource,
  screenIframeSandbox,
  screenRefreshDelay,
  screenRefreshRetryDelay,
} from "./computer-screen";

describe("computer screen requests", () => {
  it("shows connection failures and lets a successful retry clear them", async () => {
    const commit = vi.fn();
    const options = {
      isCurrent: () => true,
      commit,
      fallbackError: "Could not connect",
    };
    await loadComputerScreen({
      ...options,
      load: async () => {
        throw new Error("Control stream failed to start");
      },
    });
    expect(commit).toHaveBeenLastCalledWith({
      url: null,
      error: "Control stream failed to start",
    });

    await expect(
      loadComputerScreen({
        ...options,
        load: async () => ({ url: "https://screen.example/vnc.html" }),
      }),
    ).resolves.toBe("https://screen.example/vnc.html");
    expect(commit).toHaveBeenLastCalledWith({
      url: "https://screen.example/vnc.html",
      error: null,
    });
  });

  it.each(["success", "failure"])(
    "ignores a stale %s after a newer screen failure",
    async (outcome) => {
      let finish!: (screen: { url: string | null }) => void;
      let fail!: (error: Error) => void;
      const deferred = new Promise<{ url: string | null }>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      let current = 1;
      const commit = vi.fn();
      const stale = loadComputerScreen({
        load: () => deferred,
        isCurrent: () => current === 1,
        commit,
        fallbackError: "Could not connect",
      });
      current = 2;
      await loadComputerScreen({
        load: async () => {
          throw new Error("Latest connection failed");
        },
        isCurrent: () => current === 2,
        commit,
        fallbackError: "Could not connect",
      });
      if (outcome === "success") finish({ url: "https://stale.example/vnc.html" });
      else fail(new Error("Stale connection failed"));
      await expect(stale).resolves.toBeNull();
      expect(commit).toHaveBeenCalledExactlyOnceWith({
        url: null,
        error: "Latest connection failed",
      });
    },
  );

  it("uses the visible fallback for errors without a message", async () => {
    const commit = vi.fn();
    await loadComputerScreen({
      load: async () => Promise.reject(null),
      isCurrent: () => true,
      commit,
      fallbackError: "Could not connect",
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith({ url: null, error: "Could not connect" });
  });
});

describe("connected screen source", () => {
  const now = 1_800_000_000_000;
  const identity = "a".repeat(64);
  const source = (issued: number, id = identity, policy = "view") =>
    `https://screen.example/novnc/session/${policy}/${issued + 60 * 60_000}.fake-${issued}/embed.html#rakazoScreen=${id}`;

  it("keeps a connected iframe across five-minute seals and longer turn completions", () => {
    const held = source(now);
    for (const minutes of [6, 15, 30, 54]) {
      expect(
        retainComputerScreenSource(held, source(now + minutes * 60_000), now + minutes * 60_000),
      ).toBe(held);
    }
  });

  it("schedules renewal from the displayed link's expiry, not the last successful read", () => {
    const held = source(now);
    const kept = retainComputerScreenSource(held, source(now + 30 * 60_000), now + 30 * 60_000);
    expect(screenRefreshDelay(kept, now + 30 * 60_000)).toBe(25 * 60_000);
    const renewed = source(now + 55 * 60_000);
    expect(retainComputerScreenSource(held, renewed, now + 55 * 60_000)).toBe(renewed);
    expect(screenRefreshDelay(held, now + 61 * 60_000)).toBe(0);
  });

  it("immediately switches changed streams, origins, policies and cleared screens", () => {
    const held = source(now);
    for (const next of [
      source(now, "b".repeat(64)),
      source(now, identity, "control"),
      source(now).replace("screen.example", "other.example"),
      null,
    ]) {
      expect(retainComputerScreenSource(held, next, now)).toBe(next);
    }
    expect(retainComputerScreenSource(null, held, now)).toBe(held);
  });

  it("keeps a held screen when renewal fails and clears it when the server removes it", () => {
    const held = source(now);
    const failed = { url: null, error: "Could not connect" };
    expect(applyComputerScreenRefresh(held, failed, now + 55 * 60_000)).toEqual({
      url: held,
      preserved: true,
    });
    expect(applyComputerScreenRefresh(null, failed, now)).toEqual({ url: null, preserved: false });
    expect(applyComputerScreenRefresh(held, { url: null, error: null }, now)).toEqual({
      url: null,
      preserved: false,
    });
    expect(
      applyComputerScreenRefresh(
        held,
        { url: source(now + 6 * 60_000), error: null },
        now + 6 * 60_000,
      ),
    ).toEqual({ url: held, preserved: false });
  });

  it("backs off rejected renewals without spinning", () => {
    expect(screenRefreshRetryDelay(1)).toBe(2_000);
    expect(screenRefreshRetryDelay(2)).toBe(4_000);
    expect(screenRefreshRetryDelay(4)).toBe(16_000);
    expect(screenRefreshRetryDelay(8)).toBe(30_000);
  });

  it("does not infer sameness from opaque capabilities without a server identity", () => {
    const held = source(now).split("#")[0]!;
    const next = source(now + 6 * 60_000).split("#")[0]!;
    expect(retainComputerScreenSource(held, next, now)).toBe(next);
    expect(screenRefreshDelay("https://screen.example/vnc.html", now)).toBeNull();
    expect(screenRefreshDelay(null, now)).toBeNull();
  });
});

describe("embeddableScreenUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hides a local screen whose port does not match the page", () => {
    vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
    expect(embeddableScreenUrl("http://127.0.0.1:6080/vnc.html")).toBeNull();
    expect(embeddableScreenUrl("http://localhost:6080/vnc.html")).toBeNull();
  });

  it("keeps a non-local screen even when the port differs", () => {
    vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
    expect(embeddableScreenUrl("https://screen.example:6080/vnc.html")).toBe(
      "https://screen.example:6080/vnc.html",
    );
  });
});

describe("screenIframeSandbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows scripts and pointer lock only for /novnc/ paths", () => {
    vi.stubGlobal("window", { location: { href: "http://localhost:5173/" } });
    expect(screenIframeSandbox("http://127.0.0.1:5173/novnc/vnc.html")).toBe(
      "allow-scripts allow-pointer-lock",
    );
    expect(screenIframeSandbox("http://127.0.0.1:5173/vnc.html")).toBeUndefined();
  });
});
