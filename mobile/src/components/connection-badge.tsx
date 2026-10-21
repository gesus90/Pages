import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { RADIUS, SPACING } from "@/theme/tokens";
import { useTheme } from "@/theme/theme-provider";
import { ThemedText } from "./themed-text";

import type { ConnectionStatus } from "@/api/health";
import type { ThemeColors } from "@/theme/tokens";

interface ConnectionBadgeProps {
  readonly status: ConnectionStatus;
}

interface BadgeTone {
  readonly background: keyof ThemeColors;
  readonly foreground: keyof ThemeColors;
}

const NEUTRAL: BadgeTone = {
  background: "muted",
  foreground: "mutedForeground",
};
const POSITIVE: BadgeTone = {
  background: "successSubtle",
  foreground: "success",
};
const CAUTION: BadgeTone = {
  background: "warningSubtle",
  foreground: "warning",
};
const NEGATIVE: BadgeTone = {
  background: "destructiveSubtle",
  foreground: "destructive",
};

/** The colors of every status; a status is never told by color alone. */
const STATUS_TONES: Readonly<Record<ConnectionStatus, BadgeTone>> = {
  unconfigured: NEUTRAL,
  checking: NEUTRAL,
  connected: POSITIVE,
  offline: CAUTION,
  setupPending: CAUTION,
  unreachable: NEGATIVE,
  serverError: NEGATIVE,
  notPages: NEGATIVE,
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACING.small,
    paddingHorizontal: SPACING.medium,
    paddingVertical: SPACING.extraSmall,
    borderRadius: RADIUS.pill,
  },
  dot: { width: 8, height: 8, borderRadius: RADIUS.pill },
});

/** A pill that names the status of the connection to the Pages server. */
export function ConnectionBadge({
  status,
}: ConnectionBadgeProps): React.ReactElement {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const tone = STATUS_TONES[status];
  const label = t(`connection.status.${status}`);

  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      style={[styles.badge, { backgroundColor: colors[tone.background] }]}
    >
      <View
        style={[styles.dot, { backgroundColor: colors[tone.foreground] }]}
      />
      <ThemedText tone={tone.foreground} variant="caption">
        {label}
      </ThemedText>
    </View>
  );
}
