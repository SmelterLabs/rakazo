import { describe, expect, it } from "vitest";
import { formatLineDiff, lineDiff, parseLineDiff } from "./line-diff.js";

describe("lineDiff", () => {
  it("marks added and removed lines", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "remove", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
  });

  it("treats a new document as all additions", () => {
    expect(lineDiff("", "one\ntwo")).toEqual([
      { kind: "add", text: "one" },
      { kind: "add", text: "two" },
    ]);
  });

  it("collapses long unchanged runs around changes", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line ten");
    expect(lineDiff(before, after, 1)).toEqual([
      { kind: "skip", text: "9 unchanged" },
      { kind: "same", text: "line 9" },
      { kind: "remove", text: "line 10" },
      { kind: "add", text: "line ten" },
      { kind: "same", text: "line 11" },
      { kind: "skip", text: "8 unchanged" },
    ]);
  });

  it("returns nothing when the content is unchanged", () => {
    expect(lineDiff("same\ntext", "same\ntext")).toEqual([]);
  });

  it("round-trips through the text format", () => {
    const entries = lineDiff("keep\nold", "keep\nnew");
    expect(parseLineDiff(formatLineDiff(entries))).toEqual(entries);
  });
});

describe("lineDiff replacement bound", () => {
  it("bounds a full replacement of a large previous document", () => {
    const before = Array.from({ length: 2000 }, (_, i) => `old ${i}`).join("\n");
    const after = Array.from({ length: 2000 }, (_, i) => `new ${i}`).join("\n");
    const huge = lineDiff(before, after, 2);
    expect(huge.some((entry) => entry.kind === "skip" && /more removed/.test(entry.text))).toBe(
      true,
    );
    expect(huge.some((entry) => entry.kind === "skip" && /more added/.test(entry.text))).toBe(true);
  });
});
