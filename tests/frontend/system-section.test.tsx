// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { SystemSection } from "@/app/components/settings/system-section";
import { createI18n } from "@/app/lib/i18n";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";

function renderSection(
  respond: (port: string) => SettingsActionData | Promise<SettingsActionData>,
): void {
  const Stub = createRoutesStub([
    {
      Component: () => <SystemSection port={3000} />,
      action: async ({ request }) =>
        respond(String((await request.formData()).get("port"))),
      path: "/settings",
    },
  ]);

  render(
    <I18nextProvider i18n={createI18n("de")}>
      <Stub initialEntries={["/settings"]} />
    </I18nextProvider>,
  );
}

describe("SystemSection", () => {
  it("shows the stored port with the restart hint", async () => {
    renderSection(() => ({ intent: "update-port", ok: true, port: 1 }));

    expect(await screen.findByLabelText("Port")).toHaveValue("3000");
    expect(
      screen.getByText(/gilt nach dem nächsten Neustart von Pages/),
    ).toBeInTheDocument();
  });

  it("saves a new port and confirms it", async () => {
    const user = userEvent.setup();

    renderSection((port) => ({
      intent: "update-port",
      ok: true,
      port: Number(port),
    }));

    const field = await screen.findByLabelText("Port");

    await user.clear(field);
    await user.type(field, "8080");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Gespeichert. Der neue Port gilt nach dem nächsten Neustart.",
    );
    expect(screen.getByLabelText("Port")).toHaveValue("8080");
  });

  it.each([
    ["invalidPort", "Bitte eine ganze Zahl von 1 bis 65535 angeben."],
    ["general", "Der Port konnte nicht gespeichert werden."],
  ] as const)("explains a %s answer at the field", async (error, message) => {
    const user = userEvent.setup();

    renderSection(() => ({ error, intent: "update-port", ok: false }));
    await user.click(await screen.findByRole("button", { name: "Speichern" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Port")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("disables saving while the port is stored", async () => {
    const user = userEvent.setup();

    renderSection(() => new Promise(() => {}));
    await user.click(await screen.findByRole("button", { name: "Speichern" }));

    expect(screen.getByRole("button", { name: "Speichern" })).toBeDisabled();
  });
});
