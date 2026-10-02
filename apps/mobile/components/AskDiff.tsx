import type { LineDiffEntry } from "@rakazo/core";
import { parseLineDiff } from "@rakazo/core";
import { ScrollView, StyleSheet, Text } from "react-native";
import { useMobileTokens } from "../lib/native";

const MARK: Record<LineDiffEntry["kind"], string> = { add: "+", remove: "-", same: " ", skip: "…" };

const styles = StyleSheet.create({
  scroll: { marginTop: 8, maxHeight: 288 },
  line: {
    fontFamily: "Menlo",
    fontSize: 12.5,
    lineHeight: 20,
  },
  skip: { fontStyle: "italic" },
  remove: { textDecorationLine: "line-through" },
});

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
    <ScrollView style={styles.scroll}>
      {parseLineDiff(detail).map((entry, index) => (
        <Text
          key={index}
          style={[
            styles.line,
            { color: color[entry.kind] },
            entry.kind === "skip" ? styles.skip : null,
            entry.kind === "remove" ? styles.remove : null,
          ]}
        >
          {`${MARK[entry.kind]} ${entry.text}`}
        </Text>
      ))}
    </ScrollView>
  );
}
