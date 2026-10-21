import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useTranslation } from "react-i18next";

import { SPACING } from "@/theme/tokens";
import { AppButton } from "./app-button";
import { PicaMascot } from "./pica-mascot";
import { ThemedText } from "./themed-text";

import type { ConnectionStatus } from "@/api/health";

interface EmptySessionStateProps {
  readonly status: ConnectionStatus;
  readonly host: string | null;
  /** Opens the settings where the server address is entered. */
  readonly onSetUpServer: () => void;
}

const MASCOT_SIZE = 160;
const COMPACT_MASCOT_SIZE = 96;

// Below this window height (a phone in landscape) the mascot gives way to the text.
const COMPACT_HEIGHT = 480;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.large,
    paddingVertical: SPACING.extraLarge,
  },
  texts: { alignItems: "center", gap: SPACING.small },
  centered: { textAlign: "center" },
});

/**
 * What the Pica view shows while there is no conversation.
 *
 * @remarks
 * Conversations are not part of this version, so the view says so in words and
 * never shows an invented message. The line below says where the connection
 * stands (the header names the status), and the one action leads to the
 * settings.
 */
export function EmptySessionState({
  status,
  host,
  onSetUpServer,
}: EmptySessionStateProps): React.ReactElement {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();

  return (
    <View style={styles.container}>
      <PicaMascot
        size={height < COMPACT_HEIGHT ? COMPACT_MASCOT_SIZE : MASCOT_SIZE}
      />
      <View style={styles.texts}>
        <ThemedText
          accessibilityRole="header"
          style={styles.centered}
          variant="title"
        >
          {t("pica.emptyTitle")}
        </ThemedText>
        <ThemedText style={styles.centered} tone="mutedForeground">
          {t("pica.emptyBody")}
        </ThemedText>
        <ThemedText
          style={styles.centered}
          tone="mutedForeground"
          variant="caption"
        >
          {t("pica.notAvailable")}
        </ThemedText>
      </View>
      <ThemedText
        style={styles.centered}
        tone="mutedForeground"
        variant="caption"
      >
        {t(`connection.detail.${status}`, { host: host ?? "" })}
      </ThemedText>
      {status === "unconfigured" ? (
        <AppButton label={t("pica.setUpServer")} onPress={onSetUpServer} />
      ) : null}
    </View>
  );
}
