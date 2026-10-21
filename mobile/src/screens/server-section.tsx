import { StyleSheet, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/components/app-button";
import { ConnectionBadge } from "@/components/connection-badge";
import { SettingsSection } from "@/components/settings-section";
import { ThemedText } from "@/components/themed-text";
import { useConnection } from "@/connection/connection-provider";
import { useTheme } from "@/theme/theme-provider";
import { MINIMUM_TOUCH_TARGET, RADIUS, SPACING } from "@/theme/tokens";

import { useServerAddressForm } from "./use-server-address-form";

const styles = StyleSheet.create({
  field: { gap: SPACING.small },
  input: {
    minHeight: MINIMUM_TOUCH_TARGET,
    paddingHorizontal: SPACING.medium,
    borderRadius: RADIUS.medium,
    borderWidth: 1,
    fontSize: 16,
  },
  status: { gap: SPACING.small },
  badge: { alignItems: "flex-start" },
  actions: { gap: SPACING.small },
});

function formatTime(date: Date, language: string): string {
  return date.toLocaleTimeString(language, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AddressField(): React.ReactElement {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const form = useServerAddressForm();

  return (
    <View style={styles.field}>
      <ThemedText tone="mutedForeground" variant="label">
        {t("settings.serverAddress")}
      </ThemedText>
      <TextInput
        accessibilityHint={t("settings.serverAddressHint")}
        accessibilityLabel={t("settings.serverAddress")}
        autoCapitalize="none"
        autoCorrect={false}
        inputMode="url"
        onChangeText={form.setDraft}
        onSubmitEditing={form.save}
        placeholder={t("settings.serverAddressPlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        returnKeyType="done"
        style={[
          styles.input,
          {
            backgroundColor: colors.background,
            borderColor:
              form.problem === null ? colors.outline : colors.destructive,
            color: colors.foreground,
          },
        ]}
        textContentType="URL"
        value={form.draft}
      />
      {form.problem === null ? null : (
        <ThemedText
          accessibilityRole="alert"
          tone="destructive"
          variant="caption"
        >
          {t(`settings.addressErrors.${form.problem}`)}
        </ThemedText>
      )}
      <View style={styles.actions}>
        <AppButton
          isDisabled={!form.isChanged}
          label={t("settings.save")}
          onPress={form.save}
        />
        {form.hasSavedAddress ? (
          <AppButton
            label={t("settings.remove")}
            onPress={form.remove}
            variant="secondary"
          />
        ) : null}
      </View>
    </View>
  );
}

function ConnectionStatusBlock(): React.ReactElement {
  const { t, i18n } = useTranslation();
  const connection = useConnection();
  const canCheck =
    connection.status !== "unconfigured" && connection.status !== "checking";

  return (
    <View style={styles.status}>
      <View style={styles.badge}>
        <ConnectionBadge status={connection.status} />
      </View>
      <ThemedText tone="mutedForeground" variant="caption">
        {t(`connection.detail.${connection.status}`, {
          host: connection.host ?? "",
        })}
      </ThemedText>
      {connection.checkedAt === null ? null : (
        <ThemedText tone="mutedForeground" variant="caption">
          {t("settings.lastChecked", {
            time: formatTime(connection.checkedAt, i18n.language),
          })}
        </ThemedText>
      )}
      <AppButton
        isDisabled={!canCheck}
        label={t("settings.checkConnection")}
        onPress={connection.recheck}
        variant="secondary"
      />
    </View>
  );
}

/** The server address, the connection status and the action to check it. */
export function ServerSection(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <SettingsSection title={t("settings.connectionTitle")}>
      <AddressField />
      <ConnectionStatusBlock />
    </SettingsSection>
  );
}
