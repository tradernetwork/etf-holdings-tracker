import { useWindowDimensions, type ViewStyle } from "react-native";

/** Windows at least this wide (dp) get the large-screen layout: Chromebooks, tablets, landscape. */
export const WIDE_BREAKPOINT = 900;
/** Readable column for text/card screens. */
export const CONTENT_MAX = 840;
/** Fund books and tables can use more of the window. */
export const TABLE_MAX = 1100;

export type ContentKind = "content" | "table";

/** Max content width for a window, or null on phone-sized windows (layout unchanged). */
export function contentMaxWidth(windowWidth: number, kind: ContentKind = "content"): number | null {
  if (windowWidth < WIDE_BREAKPOINT) return null;
  return kind === "table" ? TABLE_MAX : CONTENT_MAX;
}

/** Style that centres a scroll container's content in a capped column; empty on phones. */
export function columnStyle(windowWidth: number, kind: ContentKind = "content"): ViewStyle {
  const max = contentMaxWidth(windowWidth, kind);
  return max === null ? {} : { width: "100%", maxWidth: max, alignSelf: "center" };
}

export function useLayout(kind: ContentKind = "content") {
  const { width } = useWindowDimensions();
  return { width, isWide: width >= WIDE_BREAKPOINT, column: columnStyle(width, kind) };
}
