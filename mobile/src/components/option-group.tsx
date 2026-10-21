import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, View } from "react-native";

import { MINIMUM_TOUCH_TARGET, RADIUS, SPACING } from "@/theme/tokens";
import { useTheme } from "@/theme/theme-provider";
import { ThemedText } from "./themed-text";

interface Option<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

interface OptionGroupProps<Value extends string> {
  readonly label: string;
  readonly options: readonly Option<Value>[];
  readonly value: Value;
  readonly onChange: (value: Value) => void;
}

const styles = StyleSheet.create({
  group: { gap: SPACING.small },
  row: { flexDirection: "row", gap: SPACING.small },
  option: {
    flex: 1,
    flexDirection: "row",
    gap: SPACING.extraSmall,
    minHeight: MINIMUM_TOUCH_TARGET,
    paddingHorizontal: SPACING.small,
    borderRadius: RADIUS.medium,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});

/** One choice out of a few, such as the theme; it reads as a radio group. */
export function OptionGroup<Value extends string>({
  label,
  options,
  value,
  onChange,
}: OptionGroupProps<Value>): React.ReactElement {
  const { colors } = useTheme();

  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      style={styles.group}
    >
      <ThemedText tone="mutedForeground" variant="label">
        {label}
      </ThemedText>
      <View style={styles.row}>
        {options.map((option) => {
          const isSelected = option.value === value;

          return (
            <Pressable
              accessibilityLabel={option.label}
              accessibilityRole="radio"
              accessibilityState={{ checked: isSelected }}
              key={option.value}
              onPress={() => onChange(option.value)}
              style={[
                styles.option,
                {
                  backgroundColor: isSelected
                    ? colors.primarySubtle
                    : colors.surface,
                  borderColor: isSelected ? colors.primary : colors.outline,
                },
              ]}
            >
              {isSelected ? (
                <Ionicons
                  color={colors.foreground}
                  name="checkmark"
                  size={16}
                />
              ) : null}
              <ThemedText variant="label">{option.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
