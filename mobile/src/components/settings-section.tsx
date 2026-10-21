import { StyleSheet, View } from "react-native";

import { RADIUS, SPACING } from "@/theme/tokens";
import { useTheme } from "@/theme/theme-provider";
import { ThemedText } from "./themed-text";

import type { ReactNode } from "react";

interface SettingsSectionProps {
  readonly title: string;
  readonly children: ReactNode;
}

const styles = StyleSheet.create({
  card: {
    padding: SPACING.large,
    gap: SPACING.large,
    borderRadius: RADIUS.large,
    borderWidth: 1,
  },
});

/** A titled card that groups related settings. */
export function SettingsSection({
  title,
  children,
}: SettingsSectionProps): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <ThemedText accessibilityRole="header" variant="heading">
        {title}
      </ThemedText>
      {children}
    </View>
  );
}
