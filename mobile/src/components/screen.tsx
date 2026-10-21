import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CONTENT_MAX_WIDTH, SPACING } from "@/theme/tokens";
import { useTheme } from "@/theme/theme-provider";

import type { ReactNode } from "react";

interface ScreenProps {
  readonly children: ReactNode;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  column: {
    flexGrow: 1,
    width: "100%",
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: "center",
    padding: SPACING.large,
    gap: SPACING.large,
  },
});

/**
 * The frame of a screen below the navigation header.
 *
 * @remarks
 * The header and the tab bar keep the content out of the status bar and the
 * home indicator; this frame keeps it out of a notch in landscape, centers a
 * column of readable width on tablets and scrolls when the text or the keyboard needs the room.
 */
export function Screen({ children }: ScreenProps): React.ReactElement {
  const { colors } = useTheme();

  return (
    <SafeAreaView
      edges={["left", "right"]}
      style={[styles.safeArea, { backgroundColor: colors.background }]}
    >
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.column}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}
