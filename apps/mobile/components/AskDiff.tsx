import { type LineDiffEntry, parseLineDiff } from "@rakazo/core";
import { Text, View } from "react-native";
import { useMobileTokens } from "../lib/native";

const MARK: Record<LineDiffEntry["kind"], string> = { add: "+", remove: "-", same: " ", skip: "…" };

/** Line diff in an approval card: additions green, removals red. */
export function AskDiff({ detail }: { detail: string }) {
  const tokens = useMobileTokens();
  const color: Record<LineDiffEntry["kind"], string> = {
    add: tokens.success,
    remove: tokens.destructive,
    same: tokens.mutedForeground,
    skip: tokens.mutedForeground,
  };
  return (
    <View style={{ marginTop: 8 }}>
      {parseLineDiff(detail).map((entry, index) => (
        <Text
          key={index}
          style={{
            color: color[entry.kind],
            fontFamily: "Menlo",
            fontSize: 12.5,
            lineHeight: 20,
            fontStyle: entry.kind === "skip" ? "italic" : "normal",
            textDecorationLine: entry.kind === "remove" ? "line-through" : "none",
          }}
        >
          {`${MARK[entry.kind]} ${entry.text}`}
        </Text>
      ))}
    </View>
  );
}
