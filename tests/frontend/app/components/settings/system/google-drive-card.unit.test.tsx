import { render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { GoogleDriveCard } from "@/app/components/settings/system/google-drive-card";
import { useGoogleDrive } from "@/app/components/settings/system/use-google-drive";
import { createI18n } from "@/app/lib/i18n";

import type { GoogleDriveCardModel } from "@/app/components/settings/system/use-google-drive";
import type { GoogleDriveStatus } from "@/definition/GoogleDrive";

vi.mock("@/app/components/settings/system/use-google-drive", () => ({
  useGoogleDrive: vi.fn(),
}));

const CONNECTED: GoogleDriveStatus = {
  accountEmail: "drive@example.test",
  canSignIn: true,
  missingSettings: [],
  needsFolderAccess: false,
  needsWriteAccess: false,
  isSimulation: false,
  problem: null,
  redirectUris: [
    "https://pages.example.test/settings-api/google-drive/callback",
  ],
  state: "connected",
};

function renderCard(status: GoogleDriveStatus): void {
  vi.mocked(useGoogleDrive).mockReturnValue({
    isStarting: false,
    outcome: null,
    reading: { kind: "loaded", status },
    signIn: vi.fn(),
    startError: null,
  } as unknown as GoogleDriveCardModel);
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <GoogleDriveCard />
    </I18nextProvider>,
  );
}

describe("GoogleDriveCard", () => {
  it("keeps the badge while the connection reads the folder tree", () => {
    renderCard(CONNECTED);

    expect(screen.getByText("Verbunden")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Neu anmelden" })).toBeNull();
  });

  it("offers a new sign-in when the folder access is missing", () => {
    renderCard({ ...CONNECTED, needsFolderAccess: true });

    expect(screen.getByRole("button", { name: "Neu anmelden" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Lesezugriff");
  });
});
