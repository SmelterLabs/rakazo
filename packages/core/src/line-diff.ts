export type LineDiffKind = "add" | "remove" | "same" | "skip";

export interface LineDiffEntry {
  kind: LineDiffKind;
  text: string;
}

const DIFF_PREFIX: Record<LineDiffKind, string> = {
  add: "+ ",
  remove: "- ",
  same: "  ",
  skip: "… ",
};
// Above this many line pairs the table would be too large; show a full replacement instead.
const MAX_DIFF_CELLS = 1_000_000;

/** Line diff of two documents with unchanged runs collapsed to `context` lines. */
export function lineDiff(before: string, after: string, context = 2): LineDiffEntry[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  const full = a.length * b.length > MAX_DIFF_CELLS ? replaceAll(a, b) : lcsDiff(a, b);
  return collapse(full, context);
}

/** Serialize a diff as prefixed lines ("+ ", "- ", "  ", "… ") for a plain-text field. */
export function formatLineDiff(entries: LineDiffEntry[]): string {
  return entries.map((entry) => `${DIFF_PREFIX[entry.kind]}${entry.text}`).join("\n");
}

/** Parse text produced by formatLineDiff back into typed lines for rendering. */
export function parseLineDiff(text: string): LineDiffEntry[] {
  return text.split("\n").map((line) => {
    const prefix = line.slice(0, 2);
    const kind = (Object.keys(DIFF_PREFIX) as LineDiffKind[]).find(
      (key) => DIFF_PREFIX[key] === prefix,
    );
    return kind ? { kind, text: line.slice(2) } : { kind: "same", text: line };
  });
}

const MAX_REPLACE_LINES = 80;

function replaceAll(a: string[], b: string[]): LineDiffEntry[] {
  return [...boundSide(a, "remove"), ...boundSide(b, "add")];
}

function boundSide(lines: string[], kind: "add" | "remove"): LineDiffEntry[] {
  if (lines.length <= MAX_REPLACE_LINES) {
    return lines.map((text) => ({ kind, text }));
  }
  const kept = lines.slice(0, MAX_REPLACE_LINES).map((text) => ({ kind, text }));
  kept.push({
    kind: "skip",
    text: `${lines.length - MAX_REPLACE_LINES} more ${kind === "add" ? "added" : "removed"}`,
  });
  return kept;
}

function lcsDiff(a: string[], b: string[]): LineDiffEntry[] {
  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const out: LineDiffEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ kind: "remove", text: a[i++]! });
    } else {
      out.push({ kind: "add", text: b[j++]! });
    }
  }
  while (i < a.length) out.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

function collapse(entries: LineDiffEntry[], context: number): LineDiffEntry[] {
  const keep = entries.map(() => false);
  entries.forEach((entry, index) => {
    if (entry.kind === "same") return;
    for (let k = Math.max(0, index - context); k <= index + context && k < entries.length; k++) {
      keep[k] = true;
    }
  });
  const out: LineDiffEntry[] = [];
  let hidden = 0;
  entries.forEach((entry, index) => {
    if (keep[index]) {
      if (hidden) out.push({ kind: "skip", text: `${hidden} unchanged` });
      hidden = 0;
      out.push(entry);
    } else {
      hidden++;
    }
  });
  if (hidden && out.length) out.push({ kind: "skip", text: `${hidden} unchanged` });
  return out;
}
