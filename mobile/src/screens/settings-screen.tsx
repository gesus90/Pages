import { Screen } from "@/components/screen";

import { AboutSection } from "./about-section";
import { AppearanceSection } from "./appearance-section";
import { ServerSection } from "./server-section";

/** The settings: server and connection, appearance and language, about. */
export function SettingsScreen(): React.ReactElement {
  return (
    <Screen>
      <ServerSection />
      <AppearanceSection />
      <AboutSection />
    </Screen>
  );
}
