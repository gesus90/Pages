// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { SystemSection } from "@/app/components/settings/system-section";
import { createI18n } from "@/app/lib/i18n";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type { InstanceBranding } from "@/definition/Instance";

type Responder = (formData: FormData) => SettingsActionData | Promise<never>;

function renderSection(
  respond: Responder = () => ({ intent: "update-company-name", ok: true }),
  branding: InstanceBranding = { companyName: "Muster GmbH", logoUrl: null },
): ReturnType<typeof vi.fn> {
  const onAction = vi.fn(respond);
  const Stub = createRoutesStub([
    {
      Component: () => (
        <SystemSection
          branding={branding}
          port={3000}
          status={{
            databasePath: "/data/pages.duckdb",
            startedAt: "2026-10-07T08:00:00.000Z",
            version: "9.9.9",
          }}
        />
      ),
      action: async ({ request }) => onAction(await request.formData()),
      path: "/settings/system",
    },
  ]);

  render(
    <I18nextProvider i18n={createI18n("de")}>
      <Stub initialEntries={["/settings/system"]} />
    </I18nextProvider>,
  );

  return onAction;
}

describe("status card", () => {
  it("shows version, database file and start time without a way to change them", async () => {
    renderSection();

    expect(await screen.findByText("9.9.9")).toBeInTheDocument();
    expect(screen.getByText("/data/pages.duckdb")).toBeInTheDocument();
    expect(
      screen.getByText(/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$/u),
    ).toBeVisible();
    expect(screen.queryByLabelText("Datenbankdatei")).toBeNull();
  });

  it("says when the database file is not known", async () => {
    const Stub = createRoutesStub([
      {
        Component: () => (
          <SystemSection
            branding={{ companyName: null, logoUrl: null }}
            port={3000}
            status={{
              databasePath: null,
              startedAt: "2026-10-07T08:00:00.000Z",
              version: "9.9.9",
            }}
          />
        ),
        path: "/",
      },
    ]);

    render(
      <I18nextProvider i18n={createI18n("de")}>
        <Stub />
      </I18nextProvider>,
    );

    expect(await screen.findByText("Unbekannt")).toBeInTheDocument();
  });
});

describe("company name", () => {
  it("shows the stored name and saves a new one", async () => {
    const user = userEvent.setup();
    const onAction = renderSection();
    const field = await screen.findByLabelText("Firmenname");

    expect(field).toHaveValue("Muster GmbH");

    await user.clear(field);
    await user.type(field, "Neue AG");
    await user.click(screen.getByRole("button", { name: "Name speichern" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Der Firmenname wurde gespeichert.",
    );

    const submitted = onAction.mock.calls[0]?.[0] as FormData;

    expect(submitted.get("intent")).toBe("update-company-name");
    expect(submitted.get("companyName")).toBe("Neue AG");
  });

  it.each([
    ["invalidName", "Bitte einen Namen mit höchstens 200 Zeichen angeben."],
    ["general", "Der Firmenname konnte nicht gespeichert werden."],
  ] as const)("explains a %s answer", async (error, message) => {
    const user = userEvent.setup();

    renderSection(() => ({ error, intent: "update-company-name", ok: false }));
    await user.click(
      await screen.findByRole("button", { name: "Name speichern" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Firmenname")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("disables saving while the name is stored", async () => {
    const user = userEvent.setup();

    renderSection(() => new Promise(() => {}));
    await user.click(
      await screen.findByRole("button", { name: "Name speichern" }),
    );

    expect(
      screen.getByRole("button", { name: "Name speichern" }),
    ).toBeDisabled();
  });
});

describe("company logo", () => {
  const LOGO: InstanceBranding = {
    companyName: "Muster GmbH",
    logoUrl: "/instance-logo?v=1",
  };

  it("says that no logo exists and offers no removal", async () => {
    renderSection();

    expect(
      await screen.findByText("Noch kein Logo hochgeladen."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Logo entfernen" })).toBeNull();
    expect(
      screen.getByText(/JPEG, PNG, WebP oder SVG, höchstens 2 MB/),
    ).toBeVisible();
  });

  it("previews the stored logo and offers its removal", async () => {
    renderSection(undefined, LOGO);

    expect(
      await screen.findByRole("img", { name: "Aktuelles Firmenlogo" }),
    ).toHaveAttribute("src", "/instance-logo?v=1");
    expect(
      screen.getByRole("button", { name: "Logo entfernen" }),
    ).toBeVisible();
  });

  it("removes the logo and confirms it", async () => {
    const user = userEvent.setup();
    const onAction = renderSection(
      () => ({ intent: "remove-logo", ok: true }),
      LOGO,
    );

    await user.click(
      await screen.findByRole("button", { name: "Logo entfernen" }),
    );

    expect(await screen.findByText("Das Logo wurde entfernt.")).toBeVisible();
    expect((onAction.mock.calls[0]?.[0] as FormData).get("intent")).toBe(
      "remove-logo",
    );
  });

  it("reports a logo that could not be removed", async () => {
    const user = userEvent.setup();

    renderSection(() => ({ intent: "remove-logo", ok: false }), LOGO);
    await user.click(
      await screen.findByRole("button", { name: "Logo entfernen" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Das Logo konnte nicht gespeichert werden.",
    );
  });

  it("disables the removal while it runs", async () => {
    const user = userEvent.setup();

    renderSection(() => new Promise(() => {}), LOGO);
    await user.click(
      await screen.findByRole("button", { name: "Logo entfernen" }),
    );

    expect(
      screen.getByRole("button", { name: "Logo entfernen" }),
    ).toBeDisabled();
  });
});
