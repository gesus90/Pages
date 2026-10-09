// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import SettingsSystemRoute from "@/app/routes/settings-system";
import { WIKI_SETTING_DEFAULTS } from "@/definition/Wiki";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";

interface RenderOptions {
  readonly access: "granted" | "adminModeRequired";
  readonly onAction?: (formData: FormData) => SettingsActionData;
}

function renderRoute({ access, onAction }: RenderOptions): void {
  const Stub = createRoutesStub([
    {
      Component: SettingsSystemRoute,
      action: async ({ request }) =>
        onAction?.(await request.formData()) ?? null,
      loader: () =>
        access === "granted"
          ? {
              access,
              branding: { companyName: "Muster GmbH", logoUrl: null },
              port: 3000,
              status: {
                databasePath: "/data/pages.duckdb",
                startedAt: "2026-10-07T08:00:00.000Z",
                version: "9.9.9",
              },
              wikiSettings: WIKI_SETTING_DEFAULTS,
            }
          : { access },
      path: "/settings/system",
    },
  ]);

  render(
    <I18nextProvider i18n={createI18n("de")}>
      <Stub initialEntries={["/settings/system"]} />
    </I18nextProvider>,
  );
}

describe("SettingsSystemRoute", () => {
  it("shows the server settings to an administrator in the admin mode", async () => {
    renderRoute({ access: "granted" });

    expect(await screen.findByLabelText("Port")).toHaveValue("3000");
    expect(
      screen.queryByRole("heading", { name: "Admin-Modus erforderlich" }),
    ).toBeNull();
  });

  it("asks an administrator in the role mode to switch the mode", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn((): SettingsActionData => ({
      intent: "set-mode",
      ok: true,
    }));

    renderRoute({ access: "adminModeRequired", onAction });

    expect(
      await screen.findByRole("heading", { name: "Admin-Modus erforderlich" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Die Systemeinstellungen sind nur im Admin-Modus/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Port")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Zum Admin-Modus wechseln" }),
    );

    expect(onAction).toHaveBeenCalledTimes(1);

    const submitted = (onAction.mock.calls[0] as unknown as [FormData])[0];

    expect(submitted.get("intent")).toBe("set-mode");
    expect(submitted.get("mode")).toBe("admin");
  });
});
