import { Pressable, StyleSheet } from "react-native";

import { MINIMUM_TOUCH_TARGET, RADIUS, SPACING } from "@/theme/tokens";
import { useTheme } from "@/theme/theme-provider";
import { ThemedText } from "./themed-text";

import type { ThemeColors } from "@/theme/tokens";

interface AppButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: "primary" | "secondary";
  readonly isDisabled?: boolean;
}

const styles = StyleSheet.create({
  button: {
    minHeight: MINIMUM_TOUCH_TARGET,
    paddingHorizontal: SPACING.extraLarge,
    paddingVertical: SPACING.small,
    borderRadius: RADIUS.medium,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.8 },
});

interface ButtonLook {
  readonly background: string;
  readonly border: string;
  readonly label: keyof ThemeColors;
}

function resolveLook(
  colors: ThemeColors,
  variant: "primary" | "secondary",
  isDisabled: boolean,
): ButtonLook {
  if (isDisabled) {
    return {
      background: colors.muted,
      border: colors.border,
      label: "mutedForeground",
    };
  }

  if (variant === "primary") {
    return {
      background: colors.primary,
      border: colors.primary,
      label: "primaryForeground",
    };
  }

  return {
    background: colors.surface,
    border: colors.outline,
    label: "foreground",
  };
}

/**
 * A button with the minimum touch target; primary actions use the Pica orange.
 * A disabled button is neutral, so it never looks like a faded call to action.
 */
export function AppButton({
  label,
  onPress,
  variant = "primary",
  isDisabled = false,
}: AppButtonProps): React.ReactElement {
  const { colors } = useTheme();
  const look = resolveLook(colors, variant, isDisabled);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: look.background, borderColor: look.border },
        pressed && styles.pressed,
      ]}
    >
      <ThemedText tone={look.label} variant="label">
        {label}
      </ThemedText>
    </Pressable>
  );
}
