import Constants from "expo-constants";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { PagesWordmark } from "@/components/pages-wordmark";
import { SettingsSection } from "@/components/settings-section";
import { ThemedText } from "@/components/themed-text";
import { SPACING } from "@/theme/tokens";

const WORDMARK_WIDTH = 120;

const styles = StyleSheet.create({
  about: { gap: SPACING.medium },
});

/** The app's relation to Pages and its version. */
export function AboutSection(): React.ReactElement {
  const { t } = useTranslation();
  const version = Constants.expoConfig?.version ?? "";

  return (
    <SettingsSection title={t("settings.aboutTitle")}>
      <View style={styles.about}>
        <PagesWordmark width={WORDMARK_WIDTH} />
        <ThemedText tone="mutedForeground">
          {t("settings.aboutBody")}
        </ThemedText>
        <ThemedText tone="mutedForeground" variant="caption">
          {t("settings.version", { version })}
        </ThemedText>
      </View>
    </SettingsSection>
  );
}
