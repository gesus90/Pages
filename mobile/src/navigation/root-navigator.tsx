import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useTranslation } from "react-i18next";

import { releaseSplashScreen } from "./splash";

/**
 * The navigator at the root of the app.
 *
 * @remarks
 * It renders only after fonts and settings are ready, so releasing the splash
 * screen on mount shows a finished first frame.
 */
export function RootNavigator(): React.ReactElement {
  const { t } = useTranslation();

  useEffect(() => {
    releaseSplashScreen();
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="+not-found"
          options={{ title: t("notFound.title") }}
        />
      </Stack>
    </>
  );
}
