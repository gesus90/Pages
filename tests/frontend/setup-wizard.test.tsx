// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub, Outlet, redirect } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/setup/setup-actions.server", () => ({
  handleSetupAction: vi.fn(),
}));

vi.mock("@/backend/runtime/PagesRuntime", () => ({
  getPagesRuntime: vi.fn(),
}));

import { createI18n } from "@/app/lib/i18n";
import SetupRoute from "@/app/routes/setup";

import type { UserEvent } from "@testing-library/user-event";
import type {
  SetupActionData,
  SetupLoaderData,
} from "@/app/lib/setup/setup-action-data";

const TOKEN = "valid-token";
const SUGGESTED_PATH = "/home/a/.pages/data/pages.duckdb";
const ACCESS = { suggestedDatabasePath: SUGGESTED_PATH, token: TOKEN };

type Respond = (
  fields: Record<string, string>,
) => SetupActionData | Response | Promise<SetupActionData | Response>;

/** Answers path checks with an available location unless told otherwise. */
function defaultRespond(fields: Record<string, string>): SetupActionData {
  if (fields.intent === "check-database-path") {
    return {
      intent: "check-database-path",
      location: { input: fields.databasePath ?? "", status: "available" },
    };
  }

  return { error: "failed", intent: "complete" };
}

let submissions: Record<string, string>[] = [];

function renderSetup(
  loaderData: SetupLoaderData,
  respond: Respond = defaultRespond,
): void {
  const Stub = createRoutesStub([
    {
      Component: () => <Outlet />,
      children: [
        {
          Component: SetupRoute,
          action: async ({ request }) => {
            const fields = Object.fromEntries(
              await request.formData(),
            ) as Record<string, string>;

            submissions.push(fields);

            return respond(fields);
          },
          loader: () => loaderData,
          path: "/setup",
        },
        {
          action: () => redirect("/setup"),
          path: "/set-language",
        },
        {
          Component: () => <p>Dashboard</p>,
          path: "/dashboard",
        },
        {
          Component: () => <p>Anmeldung</p>,
          path: "/login",
        },
      ],
      id: "root",
      loader: () => ({ language: "de" }),
      path: "/",
    },
  ]);

  render(
    <I18nextProvider i18n={createI18n("de")}>
      <Stub initialEntries={["/setup"]} />
    </I18nextProvider>,
  );
}

async function continueTo(user: UserEvent, label: string): Promise<void> {
  await user.click(await screen.findByRole("button", { name: label }));
}

async function walkToDatabaseStep(user: UserEvent): Promise<void> {
  await continueTo(user, "Loslegen");
  await user.type(await screen.findByLabelText("Firmenname"), "Pages GmbH");
  await continueTo(user, "Weiter");
  await user.type(await screen.findByLabelText("Benutzername"), "chef");
  await user.type(screen.getByLabelText("Passwort"), "geheimes-passwort");
  await continueTo(user, "Weiter");
  await screen.findByLabelText("Datenbankpfad");
}

const PENDING_WITH_ACCESS: SetupLoaderData = {
  access: ACCESS,
  hasRejectedToken: false,
  status: "pending",
};

describe("setup wizard", () => {
  beforeEach(() => {
    submissions = [];
  });

  it("asks for the token and unlocks the wizard with a valid one", async () => {
    const user = userEvent.setup();

    renderSetup(
      { access: null, hasRejectedToken: false, status: "pending" },
      (fields) =>
        fields.token === TOKEN
          ? { access: ACCESS, intent: "verify-token" }
          : { error: "invalidToken", intent: "verify-token" },
    );

    expect(
      await screen.findByRole("heading", { name: "Einrichtung freischalten" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Setup-Token"), "guess");
    await continueTo(user, "Freischalten");

    expect(
      await screen.findByText(/Dieser Token ist nicht gültig/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Setup-Token")).toHaveAttribute(
      "aria-invalid",
      "true",
    );

    await user.clear(screen.getByLabelText("Setup-Token"));
    await user.type(screen.getByLabelText("Setup-Token"), TOKEN);
    await continueTo(user, "Freischalten");

    expect(
      await screen.findByRole("heading", { name: "Willkommen bei Pages" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext",
      "Schritt 1 von 4",
    );
  });

  it("explains a rejected setup link and a lost connection", async () => {
    const user = userEvent.setup();

    renderSetup(
      { access: null, hasRejectedToken: true, status: "pending" },
      () => ({ error: "network", intent: "verify-token" }),
    );

    expect(
      await screen.findByText(/Dieser Token ist nicht gültig/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Setup-Token"), TOKEN);
    await continueTo(user, "Freischalten");

    expect(await screen.findByText(/Keine Verbindung/)).toBeInTheDocument();
  });

  it("walks through the steps, checks fields, and keeps entries", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS);

    await continueTo(user, "Loslegen");

    const companyField = await screen.findByLabelText("Firmenname");

    expect(companyField).toHaveFocus();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "2",
    );

    await continueTo(user, "Weiter");

    expect(screen.getByText("Bitte ausfüllen.")).toBeInTheDocument();
    expect(companyField).toHaveAttribute(
      "aria-describedby",
      "companyName-error",
    );

    await user.type(companyField, "Pages GmbH");

    expect(screen.queryByText("Bitte ausfüllen.")).not.toBeInTheDocument();

    await user.keyboard("{Enter}");
    await user.type(await screen.findByLabelText("Benutzername"), "chef");
    await user.type(screen.getByLabelText("Passwort"), "kurz");
    await user.type(screen.getByLabelText("E-Mail (optional)"), "kein-mail");
    await continueTo(user, "Weiter");

    expect(
      screen.getByText("Das Passwort braucht mindestens 8 Zeichen."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Keine gültige E-Mail-Adresse."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Passwort anzeigen" }));

    expect(screen.getByLabelText("Passwort")).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Zurück" }));

    expect(await screen.findByLabelText("Firmenname")).toHaveValue(
      "Pages GmbH",
    );

    await continueTo(user, "Weiter");

    expect(await screen.findByLabelText("Benutzername")).toHaveValue("chef");
    expect(screen.getByLabelText("E-Mail (optional)")).toHaveValue("kein-mail");
  });

  it("checks the suggested path, follows edits, and ignores old answers", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, (fields) => {
      if (fields.databasePath === "/etc/x.duckdb") {
        return {
          intent: "check-database-path",
          location: { input: "/stale.duckdb", status: "available" },
        };
      }

      return defaultRespond(fields);
    });
    await walkToDatabaseStep(user);

    const pathField = screen.getByLabelText("Datenbankpfad");

    expect(pathField).toHaveValue(SUGGESTED_PATH);
    expect(screen.getByText("Pfad wird geprüft …")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fertig" })).toBeDisabled();
    expect(
      await screen.findByText("Speicherort verfügbar"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fertig" })).toBeEnabled();

    await user.clear(pathField);

    expect(screen.getByText("Bitte Pfad angeben")).toBeInTheDocument();

    await user.type(pathField, "/etc/x.duckdb");
    await waitFor(() =>
      expect(
        submissions.some((fields) => fields.databasePath === "/etc/x.duckdb"),
      ).toBe(true),
    );

    // The answer names another path, so it is never shown for this one.
    expect(screen.getByText("Pfad wird geprüft …")).toBeInTheDocument();
    expect(
      submissions.filter((fields) => fields.intent === "check-database-path"),
    ).toHaveLength(2);
  });

  it.each([
    ["invalid", "Kein gültiger Pfad"],
    ["notWritable", "Keine Schreibrechte unter diesem Pfad"],
    ["foreign", "Dort liegt eine andere Datei"],
    ["existing", "Bestehende Datenbank wird geöffnet"],
  ] as const)("shows the %s check result", async (status, message) => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, (fields) => ({
      intent: "check-database-path",
      location: { input: fields.databasePath ?? "", status },
    }));
    await walkToDatabaseStep(user);

    expect(await screen.findByText(new RegExp(message))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fertig" })).toHaveProperty(
      "disabled",
      status !== "existing",
    );
  });

  it("reports a path check that could not reach the server", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, () => ({
      error: "network",
      intent: "check-database-path",
    }));
    await walkToDatabaseStep(user);

    expect(
      await screen.findByText(/konnte nicht geprüft werden/),
    ).toBeInTheDocument();
  });

  it("finishes the setup and opens the dashboard", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, (fields) =>
      fields.intent === "complete"
        ? redirect("/dashboard")
        : defaultRespond(fields),
    );
    await walkToDatabaseStep(user);
    await screen.findByText("Speicherort verfügbar");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Dashboard")).toBeInTheDocument();
    expect(submissions.at(-1)).toEqual({
      companyName: "Pages GmbH",
      databasePath: SUGGESTED_PATH,
      email: "",
      intent: "complete",
      password: "geheimes-passwort",
      token: TOKEN,
      username: "chef",
    });
  });

  it("shows a running setup and prevents a second submission", async () => {
    const user = userEvent.setup();
    let finish: (answer: SetupActionData) => void = () => {};

    renderSetup(PENDING_WITH_ACCESS, (fields) =>
      fields.intent === "complete"
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : defaultRespond(fields),
    );
    await walkToDatabaseStep(user);
    await screen.findByText("Speicherort verfügbar");
    await continueTo(user, "Fertig");

    const pending = await screen.findByRole("button", {
      name: "Wird eingerichtet …",
    });

    expect(pending).toBeDisabled();
    expect(screen.getByRole("button", { name: "Zurück" })).toBeDisabled();

    finish({ error: "failed", intent: "complete" });

    expect(
      await screen.findByText(/Pages bleibt im Einrichtungsmodus/),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("opens the step of a field the server rejected", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, (fields) =>
      fields.intent === "complete"
        ? {
            error: "invalidInput",
            fieldErrors: { username: "usernameTaken" },
            intent: "complete",
          }
        : defaultRespond(fields),
    );
    await walkToDatabaseStep(user);
    await screen.findByText("Speicherort verfügbar");
    await continueTo(user, "Fertig");

    expect(
      await screen.findByText(/gehört zu einem Konto ohne Administratorrechte/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Benutzername")).toHaveValue("chef");
  });

  it("shows a path the server refused when finishing", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, (fields) =>
      fields.intent === "complete"
        ? {
            error: "databaseLocation",
            intent: "complete",
            location: { input: SUGGESTED_PATH, status: "foreign" },
          }
        : defaultRespond(fields),
    );
    await walkToDatabaseStep(user);
    await screen.findByText("Speicherort verfügbar");
    await continueTo(user, "Fertig");

    expect(
      await screen.findByText(/Dort liegt eine andere Datei/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Datenbankpfad")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("asks for a new token when the server no longer accepts it, keeping entries", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, (fields) => {
      if (fields.intent === "complete") {
        return { error: "invalidToken", intent: "complete" };
      }

      if (fields.intent === "verify-token") {
        return {
          access: { ...ACCESS, token: "new-token" },
          intent: "verify-token",
        };
      }

      return defaultRespond(fields);
    });
    await walkToDatabaseStep(user);
    await screen.findByText("Speicherort verfügbar");
    await continueTo(user, "Fertig");

    expect(
      await screen.findByText(/Setup-Zugang ist nicht mehr gültig/),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText("Setup-Token"), "new-token");
    await continueTo(user, "Freischalten");

    expect(await screen.findByLabelText("Datenbankpfad")).toHaveValue(
      SUGGESTED_PATH,
    );
  });

  it("asks for a new token when a path check is refused", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, () => ({
      error: "invalidToken",
      intent: "check-database-path",
    }));
    await walkToDatabaseStep(user);

    expect(
      await screen.findByText(/Setup-Zugang ist nicht mehr gültig/),
    ).toBeInTheDocument();
  });

  it("offers the sign-in when another request finished the setup", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS, (fields) =>
      fields.intent === "complete"
        ? { error: "alreadyCompleted", intent: "complete" }
        : defaultRespond(fields),
    );
    await walkToDatabaseStep(user);
    await screen.findByText("Speicherort verfügbar");
    await continueTo(user, "Fertig");

    await user.click(
      await screen.findByRole("link", { name: "Zur Anmeldung" }),
    );

    expect(await screen.findByText("Anmeldung")).toBeInTheDocument();
  });

  it("only offers the sign-in after the setup finished", async () => {
    renderSetup({ status: "completed" });

    expect(
      await screen.findByRole("heading", { name: "Pages ist eingerichtet" }),
    ).toBeInTheDocument();
  });

  it("keeps entries when the language changes", async () => {
    const user = userEvent.setup();

    renderSetup(PENDING_WITH_ACCESS);
    await continueTo(user, "Loslegen");
    await user.type(await screen.findByLabelText("Firmenname"), "Pages GmbH");
    await user.click(screen.getByRole("combobox", { name: "Sprache" }));
    await user.click(await screen.findByRole("option", { name: "EN" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Firmenname")).toHaveValue("Pages GmbH"),
    );
  });

  it("falls back to German without root data", async () => {
    const Stub = createRoutesStub([
      {
        Component: SetupRoute,
        loader: () => ({ status: "completed" }),
        path: "/setup",
      },
    ]);

    render(
      <I18nextProvider i18n={createI18n("de")}>
        <Stub initialEntries={["/setup"]} />
      </I18nextProvider>,
    );

    expect(
      await screen.findByRole("combobox", { name: "Sprache" }),
    ).toHaveTextContent("DE");
  });
});
