export type Panel =
  | "computer"
  | "settings"
  | "routine"
  | "create"
  | "create-group"
  | "group-settings"
  | null;
export type RightPanelState = { panel: Panel; routineId?: string };
const panels: readonly Panel[] = [
  "computer",
  "settings",
  "routine",
  "create",
  "create-group",
  "group-settings",
  null,
];

export function readRightPanelState(key: string): RightPanelState {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("panel" in value) ||
      !panels.includes(value.panel as Panel)
    )
      return { panel: null };
    return {
      panel: value.panel as Panel,
      ...(value.panel === "routine" &&
      "routineId" in value &&
      typeof value.routineId === "string" &&
      value.routineId
        ? { routineId: value.routineId }
        : {}),
    };
  } catch {
    return { panel: null };
  }
}

export function writeRightPanelState(key: string, panel: Panel, routineId?: string) {
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ panel, ...(panel === "routine" && routineId ? { routineId } : {}) }),
    );
  } catch {
    // Restricted storage must not prevent opening or closing the panel.
  }
}
