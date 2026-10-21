import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { AppButton } from "@/components/app-button";
import { Screen } from "@/components/screen";
import { ThemedText } from "@/components/themed-text";

/** Shown for an address the app has no screen for. */
export function NotFoundScreen(): React.ReactElement {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <Screen>
      <ThemedText accessibilityRole="header" variant="title">
        {t("notFound.title")}
      </ThemedText>
      <ThemedText tone="mutedForeground">{t("notFound.body")}</ThemedText>
      <AppButton
        label={t("notFound.back")}
        onPress={() => router.replace("/")}
      />
    </Screen>
  );
}
