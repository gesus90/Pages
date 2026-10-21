import * as SplashScreen from "expo-splash-screen";

function warnAboutSplash(error: unknown): void {
  console.warn("[pica] The splash screen could not be controlled.", error);
}

/** Keeps the native splash screen visible until the app is ready to draw. */
export function holdSplashScreen(): void {
  SplashScreen.preventAutoHideAsync().catch(warnAboutSplash);
}

/** Hides the native splash screen once the first real frame can be drawn. */
export function releaseSplashScreen(): void {
  SplashScreen.hideAsync().catch(warnAboutSplash);
}
