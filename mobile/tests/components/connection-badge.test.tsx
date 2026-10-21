import { ConnectionBadge } from "@/components/connection-badge";

import { renderWithProviders } from "../render-with-providers";

import type { ConnectionStatus } from "@/api/health";

const STATUSES: readonly [ConnectionStatus, string, string][] = [
  ["unconfigured", "No server", "Kein Server"],
  ["offline", "Offline", "Offline"],
  ["checking", "Checking", "Prüfung läuft"],
  ["connected", "Connected", "Verbunden"],
  ["setupPending", "Setup pending", "Einrichtung offen"],
  ["unreachable", "Not reachable", "Nicht erreichbar"],
  ["serverError", "Server error", "Serverfehler"],
  ["notPages", "Not a Pages server", "Kein Pages-Server"],
];

describe("ConnectionBadge", () => {
  it.each(STATUSES)(
    "names the status %s in English and German",
    (status, english, german) => {
      const inEnglish = renderWithProviders(
        <ConnectionBadge status={status} />,
      );

      expect(inEnglish.getByText(english)).toBeTruthy();
      inEnglish.unmount();

      const inGerman = renderWithProviders(
        <ConnectionBadge status={status} />,
        {
          language: "de",
        },
      );

      expect(inGerman.getByText(german)).toBeTruthy();
    },
  );
});
