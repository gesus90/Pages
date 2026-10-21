import { Text } from "react-native";

import { TYPOGRAPHY } from "@/theme/tokens";
import { useTheme } from "@/theme/theme-provider";

import type { TextProps } from "react-native";
import type { ThemeColors } from "@/theme/tokens";

interface ThemedTextProps extends TextProps {
  readonly variant?: keyof typeof TYPOGRAPHY;
  readonly tone?: keyof ThemeColors;
}

/**
 * Text in the type scale and the semantic colors of the theme.
 *
 * @remarks
 * Text grows with the system font size, so layouts around it must not rely on a
 * fixed height.
 */
export function ThemedText({
  variant = "body",
  tone = "foreground",
  style,
  ...rest
}: ThemedTextProps): React.ReactElement {
  const { colors } = useTheme();

  return (
    <Text
      {...rest}
      style={[TYPOGRAPHY[variant], { color: colors[tone] }, style]}
    />
  );
}
