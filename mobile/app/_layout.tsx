import Ionicons from "@expo/vector-icons/Ionicons";
import { useFonts } from "expo-font";

import { AppProviders } from "@/app-providers";
import { RootNavigator } from "@/navigation/root-navigator";
import { holdSplashScreen } from "@/navigation/splash";

// The splash screen stays up until the icon font and the stored settings are
// ready; `RootNavigator` releases it with the first real frame.
holdSplashScreen();

/**
 * The root of the app: loads the icon font, then provides settings, theme,
 * language and connection to the navigation.
 *
 * @returns The app, or nothing while the splash screen is still up.
 */
export default function RootLayout(): React.ReactElement | null {
  const [areFontsLoaded, fontError] = useFonts(Ionicons.font);

  if (!areFontsLoaded && fontError === null) {
    return null;
  }

  return (
    <AppProviders>
      <RootNavigator />
    </AppProviders>
  );
}
