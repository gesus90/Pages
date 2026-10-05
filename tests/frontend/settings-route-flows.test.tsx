// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useLoaderData: vi.fn(),
    useNavigation: vi.fn(),
    useSubmit: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "react-router";

import { createI18n } from "@/app/lib/i18n";
import SettingsRoute from "@/app/routes/settings";
import { ROLE } from "@/definition/Role";
import { DEFAULT_USER_SETTINGS } from "@/definition/Settings";
import { LANGUAGE } from "@/language/Language";

import { createSettingsLoaderData } from "../helpers/settings-loader-data";

import type { SettingsLoaderFixture } from "../helpers/settings-loader-data";
import type { SessionSummary } from "@/definition/Session";

const mockedActionData = vi.mocked(useActionData);
const mockedLoaderData = vi.mocked(useLoaderData);
const mockedNavigation = vi.mocked(useNavigation);
const mockedSubmit = vi.mocked(useSubmit);

interface Harness {
  readonly submit: ReturnType<typeof vi.fn>;
  /** Changes what the route sees as action data or navigation, then renders. */
  readonly update: (state: {
    actionData?: unknown;
    navigation?: unknown;
  }) => void;
}

function renderSettings(
  loader: Partial<SettingsLoaderFixture> = {},
  initial: { actionData?: unknown; navigation?: unknown } = {},
): Harness {
  const submit = vi.fn();
  let forceRender: () => void = () => {};

  mockedLoaderData.mockReturnValue(createSettingsLoaderData(loader));
  mockedSubmit.mockReturnValue(
    submit as unknown as ReturnType<typeof useSubmit>,
  );
  mockedNavigation.mockReturnValue(
    (initial.navigation ?? { state: "idle" }) as ReturnType<
      typeof useNavigation
    >,
  );
  mockedActionData.mockReturnValue(initial.actionData);

  function RouteHarness(): React.ReactElement {
    const [, setCount] = useState(0);

    forceRender = () => setCount((count) => count + 1);

    return <SettingsRoute />;
  }

  const router = createMemoryRouter(
    [{ element: <RouteHarness />, path: "/settings" }],
    { initialEntries: ["/settings"] },
  );

  render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return {
    submit,
    update: (state) => {
      if ("actionData" in state) {
        mockedActionData.mockReturnValue(state.actionData);
      }

      if ("navigation" in state) {
        mockedNavigation.mockReturnValue(
          state.navigation as ReturnType<typeof useNavigation>,
        );
      }

      act(() => forceRender());
    },
  };
}

function submittedFields(submit: ReturnType<typeof vi.fn>, call = 0): unknown {
  const formData = submit.mock.calls[call]?.[0] as FormData;

  return Object.fromEntries(
    [...formData.entries()].map(([key, value]) => [
      key,
      value instanceof File ? `file:${value.name}` : value,
    ]),
  );
}

function pickAvatar(file: File): void {
  const input = document.querySelector(
    'input[type="file"]',
  ) as HTMLInputElement;

  fireEvent.change(input, { target: { files: [file] } });
}

function createImage(name = "me.png", type = "image/png", size = 10): File {
  return new File([new Uint8Array(size)], name, { type });
}

const SESSIONS: readonly SessionSummary[] = [
  {
    browser: "Firefox",
    createdAt: "2026-01-01 10:00:00",
    id: "session-1",
    isCurrent: true,
    lastUsedAt: "2026-01-01 10:00:00",
    operatingSystem: "Linux",
  },
  {
    browser: "Safari",
    createdAt: "2026-01-01 10:00:00",
    id: "session-2",
    isCurrent: false,
    lastUsedAt: "2000-01-01 10:00:00",
    operatingSystem: "iOS",
  },
  {
    browser: null,
    createdAt: "2026-01-01 10:00:00",
    id: "session-3",
    isCurrent: false,
    lastUsedAt: "2000-01-01 10:00:00",
    operatingSystem: null,
  },
];

const EMPLOYEE = {
  avatarColor: null,
  avatarIcon: null,
  avatarImageUrl: null,
  avatarType: "initials",
  displayName: "Erika",
  id: "user-2",
  isActive: true,
  role: ROLE.EMPLOYEE,
  username: "erika",
} as const;

describe("settings screen flows", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preview"),
      revokeObjectURL: vi.fn(),
    });
  });

  describe("preferences", () => {
    it("submits the whole form when a notification switch is flipped", async () => {
      const user = userEvent.setup();
      const { submit } = renderSettings();

      const [firstSwitch] = screen.getAllByRole("switch");

      await user.click(firstSwitch as HTMLElement);

      expect(submittedFields(submit)).toMatchObject({
        "notification.email": "off",
        intent: "update-settings",
      });
    });

    it("submits the timezone, date format and week start the user picks", async () => {
      const user = userEvent.setup();
      const { submit } = renderSettings();

      await user.click(screen.getByRole("combobox", { name: "Zeitzone" }));
      await user.click(
        await screen.findByRole("option", { name: /Europe\/Paris/ }),
      );
      await user.click(screen.getByRole("combobox", { name: "Datumsformat" }));
      await user.click(
        await screen.findByRole("option", { name: "YYYY-MM-DD" }),
      );
      await user.click(screen.getByRole("combobox", { name: "Wochenstart" }));
      await user.click(await screen.findByRole("option", { name: "Sonntag" }));

      expect(submittedFields(submit, 0)).toMatchObject({
        timezone: "Europe/Paris",
      });
      expect(submittedFields(submit, 1)).toMatchObject({
        dateFormat: "YYYY-MM-DD",
      });
      expect(submittedFields(submit, 2)).toMatchObject({ weekStart: "sunday" });
    });

    it("clears the timezone when it is set to not specified", async () => {
      const user = userEvent.setup();
      const { submit } = renderSettings({
        settings: { ...DEFAULT_USER_SETTINGS, timezone: "Europe/Berlin" },
      });

      await user.click(screen.getByRole("combobox", { name: "Zeitzone" }));
      await user.click(
        await screen.findByRole("option", { name: /Nicht festgelegt/ }),
      );

      expect(submittedFields(submit)).toMatchObject({ timezone: "" });
    });

    it("shows the system section to administrators only", () => {
      renderSettings();

      expect(screen.getByText("Systembereich")).toBeInTheDocument();
    });

    it("hides the system section from everyone else", () => {
      renderSettings({
        assignableRoles: [],
        canEditProfile: false,
        user: EMPLOYEE,
      });

      expect(screen.queryByText("Systembereich")).toBeNull();
    });
  });

  describe("sessions", () => {
    it("lists the sessions with their devices", () => {
      renderSettings({ sessions: SESSIONS });

      expect(screen.getByText("Firefox · Linux")).toBeInTheDocument();
      expect(screen.getByText("Aktuelle Sitzung")).toBeInTheDocument();
      expect(screen.getByText("Safari · iOS")).toBeInTheDocument();
      expect(screen.getByText("Unbekanntes Gerät")).toBeInTheDocument();
    });

    it("signs out one other session from its menu", async () => {
      const user = userEvent.setup();
      const { submit } = renderSettings({ sessions: SESSIONS });

      const [menu] = screen.getAllByRole("button", { name: "Sitzungsmenü" });

      await user.click(menu as HTMLElement);
      await user.click(
        await screen.findByRole("menuitem", { name: "Sitzung beenden" }),
      );

      expect(submittedFields(submit)).toEqual({
        intent: "revoke-session",
        sessionId: "session-2",
      });
    });

    it("offers to end all other sessions only when there are some", async () => {
      const user = userEvent.setup();

      renderSettings({ sessions: SESSIONS });
      await user.click(
        screen.getByRole("button", { name: "Alle anderen Sitzungen beenden" }),
      );

      expect(
        await screen.findByRole("dialog", {
          name: "Alle anderen Sitzungen beenden?",
        }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("does not offer it with a single session", () => {
      renderSettings({ sessions: SESSIONS.slice(0, 1) });

      expect(
        screen.queryByRole("button", {
          name: "Alle anderen Sitzungen beenden",
        }),
      ).toBeNull();
    });

    it("closes the dialog once the server ended the sessions", async () => {
      const user = userEvent.setup();
      const harness = renderSettings({ sessions: SESSIONS });

      await user.click(
        screen.getByRole("button", { name: "Alle anderen Sitzungen beenden" }),
      );
      await screen.findByRole("dialog");

      harness.update({ actionData: { intent: "revoke-other-sessions" } });

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("shows that the sessions are being ended", async () => {
      const user = userEvent.setup();
      const harness = renderSettings({ sessions: SESSIONS });

      await user.click(
        screen.getByRole("button", { name: "Alle anderen Sitzungen beenden" }),
      );
      await screen.findByRole("dialog");
      harness.update({
        navigation: {
          formData: new Map([["intent", "revoke-other-sessions"]]),
          state: "submitting",
        },
      });

      expect(
        screen.getByRole("button", { name: "Wird beendet …" }),
      ).toBeDisabled();
    });
  });

  describe("password dialog", () => {
    async function openDialog(): Promise<void> {
      await userEvent.click(
        screen.getByRole("button", { name: "Passwort ändern" }),
      );
      await screen.findByRole("dialog", { name: "Passwort ändern" });
    }

    it("opens with three password fields and can be cancelled", async () => {
      renderSettings();

      await openDialog();

      expect(screen.getByLabelText("Aktuelles Passwort")).toBeInTheDocument();
      expect(screen.getByLabelText("Neues Passwort")).toBeInTheDocument();
      expect(
        screen.getByLabelText("Neues Passwort bestätigen"),
      ).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it.each([
      ["invalidCurrent", "Das aktuelle Passwort ist falsch."],
      ["mismatch", "Die neuen Passwörter stimmen nicht überein."],
      ["tooShort", "Das neue Passwort muss mindestens 8 Zeichen lang sein."],
    ])("explains the outcome %s", async (outcome, message) => {
      const harness = renderSettings();

      await openDialog();
      harness.update({ actionData: { intent: "change-password", outcome } });

      expect(screen.getByText(message)).toBeInTheDocument();
    });

    it("closes after a successful change", async () => {
      const harness = renderSettings();

      await openDialog();
      harness.update({
        actionData: { intent: "change-password", outcome: "success" },
      });

      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("shows that the password is being changed", async () => {
      const harness = renderSettings();

      await openDialog();
      harness.update({
        navigation: {
          formData: new Map([["intent", "change-password"]]),
          state: "submitting",
        },
      });

      expect(
        screen.getByRole("button", { name: "Wird geändert …" }),
      ).toBeDisabled();
    });

    it("keeps its last message when another form answers meanwhile", async () => {
      const harness = renderSettings();

      await openDialog();
      harness.update({
        actionData: { intent: "change-password", outcome: "mismatch" },
      });
      harness.update({ actionData: { intent: "revoke-session" } });

      expect(
        screen.getByText("Die neuen Passwörter stimmen nicht überein."),
      ).toBeInTheDocument();
    });

    it("forgets an old error when it is opened again", async () => {
      const harness = renderSettings();

      await openDialog();
      harness.update({
        actionData: { intent: "change-password", outcome: "mismatch" },
      });
      await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
      await openDialog();

      expect(
        screen.queryByText("Die neuen Passwörter stimmen nicht überein."),
      ).toBeNull();
    });
  });

  describe("profile of an administrator", () => {
    async function startEditing(): Promise<void> {
      await userEvent.click(screen.getByRole("button", { name: "Bearbeiten" }));
    }

    it("shows the stored profile values and a hint for a missing email", () => {
      renderSettings({ email: null });

      expect(screen.getByText("Nicht hinterlegt")).toBeInTheDocument();
      expect(screen.getByText("@admin")).toBeInTheDocument();
      expect(screen.getByText("Administrator")).toBeInTheDocument();
    });

    it("shows the hint for a blank email as well", () => {
      renderSettings({ email: "" });

      expect(screen.getByText("Nicht hinterlegt")).toBeInTheDocument();
    });

    it("enables saving only once something changed", async () => {
      renderSettings();
      await startEditing();

      const save = screen.getByRole("button", { name: "Änderungen speichern" });

      expect(screen.getByLabelText("Vollständiger Name")).toHaveValue("Admin");
      expect(screen.getByLabelText("Benutzername")).toHaveValue("@admin");
      expect(screen.getByLabelText("E-Mail")).toHaveValue(
        "admin@example.invalid",
      );
      expect(save).toBeDisabled();

      await userEvent.type(screen.getByLabelText("Vollständiger Name"), "x");

      expect(save).toBeEnabled();
    });

    it("submits the changed profile as multipart form", async () => {
      const { submit } = renderSettings();

      await startEditing();
      await userEvent.clear(screen.getByLabelText("Vollständiger Name"));
      await userEvent.type(
        screen.getByLabelText("Vollständiger Name"),
        " Root ",
      );
      await userEvent.clear(screen.getByLabelText("Benutzername"));
      await userEvent.type(screen.getByLabelText("Benutzername"), "@root");
      await userEvent.clear(screen.getByLabelText("E-Mail"));
      await userEvent.type(
        screen.getByLabelText("E-Mail"),
        "root@example.invalid",
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      );

      expect(submittedFields(submit)).toEqual({
        displayName: "Root",
        email: "root@example.invalid",
        intent: "update-profile",
        role: "admin",
        username: "root",
      });
      expect(submit.mock.calls[0]?.[1]).toEqual({
        encType: "multipart/form-data",
        method: "post",
      });
    });

    it("lets the administrator pick another role", async () => {
      const { submit } = renderSettings();

      await startEditing();
      await userEvent.click(
        screen.getByRole("combobox", { name: "Position / Rolle" }),
      );
      await userEvent.click(
        await screen.findByRole("option", { name: "Manager" }),
      );
      await userEvent.click(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      );

      expect(submittedFields(submit)).toMatchObject({ role: "manager" });
    });

    it.each([
      ["a blank name", "Vollständiger Name", "   "],
      ["a username of just the @", "Benutzername", "@"],
      ["a malformed email address", "E-Mail", "not-an-address"],
    ])("refuses %s before submitting", async (_label, field, value) => {
      const { submit } = renderSettings();

      await startEditing();
      await userEvent.clear(screen.getByLabelText(field));
      await userEvent.type(screen.getByLabelText(field), value);
      await userEvent.click(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      );

      expect(submit).not.toHaveBeenCalled();
      expect(
        screen.getByText("Bitte überprüfen Sie Ihre Eingaben."),
      ).toBeInTheDocument();
    });

    it("sends a profile that has an email left empty", async () => {
      const { submit } = renderSettings();

      await startEditing();
      await userEvent.clear(screen.getByLabelText("E-Mail"));
      await userEvent.click(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      );

      expect(submittedFields(submit)).toMatchObject({ email: "" });
    });

    it("returns to the read-only view when editing is cancelled", async () => {
      renderSettings();

      await startEditing();
      await userEvent.type(screen.getByLabelText("Vollständiger Name"), "x");
      await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(screen.queryByLabelText("Vollständiger Name")).toBeNull();
      expect(screen.getByText("Admin")).toBeInTheDocument();
    });

    it("shows what the server rejected", async () => {
      const harness = renderSettings();

      await startEditing();
      harness.update({
        actionData: {
          error: "usernameTaken",
          intent: "update-profile",
          ok: false,
        },
      });

      expect(
        screen.getByText("Dieser Benutzername ist bereits vergeben."),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Vollständiger Name")).toBeInTheDocument();
    });

    it("closes the editor once the profile is saved", async () => {
      const harness = renderSettings();

      await startEditing();
      harness.update({ actionData: { intent: "update-profile", ok: true } });

      expect(screen.queryByLabelText("Vollständiger Name")).toBeNull();
    });

    it("shows that the profile is being saved", async () => {
      const harness = renderSettings();

      await startEditing();
      await userEvent.type(screen.getByLabelText("Vollständiger Name"), "x");
      harness.update({
        navigation: {
          formData: new Map([["intent", "update-profile"]]),
          state: "submitting",
        },
      });

      expect(
        screen.getByRole("button", { name: "Wird gespeichert …" }),
      ).toBeDisabled();
    });

    it("starts editing when the avatar button is used, and sends the picked image", async () => {
      const { submit } = renderSettings();

      await userEvent.click(
        screen.getAllByRole("button", {
          name: "Profilbild ändern",
        })[0] as HTMLElement,
      );

      expect(screen.getByLabelText("Vollständiger Name")).toBeInTheDocument();

      pickAvatar(createImage("me.png"));
      await userEvent.click(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      );

      expect(submittedFields(submit)).toMatchObject({ avatar: "file:me.png" });
    });

    it("starts editing by picking an image while the form is closed", () => {
      renderSettings();

      pickAvatar(createImage());

      expect(screen.getByLabelText("Vollständiger Name")).toBeInTheDocument();
    });

    it("keeps the editor open when the avatar button is used again", async () => {
      renderSettings();

      await startEditing();
      await userEvent.click(
        screen.getAllByRole("button", {
          name: "Profilbild ändern",
        })[0] as HTMLElement,
      );
      pickAvatar(createImage("first.png"));
      pickAvatar(createImage("second.png"));

      expect(screen.getByLabelText("Vollständiger Name")).toBeInTheDocument();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    });

    it.each([
      ["a file that is no supported image", createImage("a.gif", "image/gif")],
      [
        "an image over 5 MB",
        createImage("big.png", "image/png", 5 * 1024 * 1024 + 1),
      ],
    ])("refuses %s", async (_label, file) => {
      renderSettings();

      await startEditing();
      pickAvatar(file);

      expect(
        screen.getByText(
          "Ungültige Bilddatei (nur JPG, PNG oder WebP bis 5 MB).",
        ),
      ).toBeInTheDocument();
    });

    it("ignores an empty file selection", async () => {
      renderSettings();

      await startEditing();
      const input = document.querySelector(
        'input[type="file"]',
      ) as HTMLInputElement;

      fireEvent.change(input, { target: { files: [] } });

      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it("releases the preview when editing is cancelled", async () => {
      renderSettings();

      await startEditing();
      pickAvatar(createImage());
      await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    });
  });

  describe("profile of everyone else", () => {
    const PROPS = {
      assignableRoles: [],
      canEditProfile: false,
      email: null,
      user: EMPLOYEE,
    };

    it("offers no editing, only a new avatar", () => {
      renderSettings(PROPS);

      expect(screen.queryByRole("button", { name: "Bearbeiten" })).toBeNull();
      expect(
        screen.getByText("JPG, PNG oder WebP (max. 5 MB)"),
      ).toBeInTheDocument();
    });

    it("sends only the avatar", async () => {
      const { submit } = renderSettings(PROPS);

      await userEvent.click(
        screen.getAllByRole("button", {
          name: "Profilbild ändern",
        })[1] as HTMLElement,
      );
      pickAvatar(createImage("me.png"));
      await userEvent.click(
        screen.getByRole("button", { name: "Änderungen speichern" }),
      );

      expect(submittedFields(submit)).toEqual({
        avatar: "file:me.png",
        intent: "update-avatar",
      });
    });

    it("discards a picked avatar again", async () => {
      renderSettings(PROPS);

      pickAvatar(createImage());
      await userEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

      expect(
        screen.queryByRole("button", { name: "Änderungen speichern" }),
      ).toBeNull();
    });

    it("explains a refused image next to the avatar", () => {
      renderSettings(PROPS);

      pickAvatar(createImage("a.gif", "image/gif"));

      expect(
        screen.getByText(
          "Ungültige Bilddatei (nur JPG, PNG oder WebP bis 5 MB).",
        ),
      ).toBeInTheDocument();
    });

    it("shows that the avatar is being saved and cannot be sent twice", async () => {
      const harness = renderSettings(PROPS);

      pickAvatar(createImage());
      harness.update({
        navigation: {
          formData: new Map([["intent", "update-avatar"]]),
          state: "submitting",
        },
      });

      const save = screen.getByRole("button", { name: "Wird gespeichert …" });

      expect(save).toBeDisabled();

      fireEvent.click(save);

      expect(harness.submit).not.toHaveBeenCalled();
    });

    it("resets after the avatar was saved", () => {
      const harness = renderSettings(PROPS);

      pickAvatar(createImage());
      harness.update({ actionData: { intent: "update-avatar", ok: true } });

      expect(
        screen.queryByRole("button", { name: "Änderungen speichern" }),
      ).toBeNull();
    });

    it("reports a failed avatar upload", () => {
      const harness = renderSettings(PROPS);

      pickAvatar(createImage());
      harness.update({
        actionData: { error: "general", intent: "update-avatar", ok: false },
      });

      expect(
        screen.getByText("Das Profil konnte nicht gespeichert werden."),
      ).toBeInTheDocument();
    });
  });

  describe("session activity", () => {
    it("shows how long ago other sessions were used", () => {
      const recent = new Date(Date.now() - 5 * 60 * 1000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);
      const hours = new Date(Date.now() - 3 * 60 * 60 * 1000)
        .toISOString()
        .replace("T", " ")
        .slice(0, 19);

      renderSettings({
        sessions: [
          { ...SESSIONS[1], lastUsedAt: recent } as SessionSummary,
          { ...SESSIONS[2], lastUsedAt: hours } as SessionSummary,
        ],
      });

      const rows = screen.getAllByText(/Vor \d+ (Minuten|Stunden)/u);

      expect(rows.map((row) => row.textContent)).toEqual([
        "Vor 5 Minuten",
        "Vor 3 Stunden",
      ]);
    });

    it("shows the date for older activity and now for a just used session", () => {
      const now = new Date().toISOString().replace("T", " ").slice(0, 19);

      renderSettings({
        sessions: [
          { ...SESSIONS[1], lastUsedAt: now } as SessionSummary,
          {
            ...SESSIONS[2],
            lastUsedAt: "2000-01-02T03:04:05",
          } as SessionSummary,
        ],
      });

      expect(screen.getByText("Jetzt")).toBeInTheDocument();
      expect(screen.getByText(/02\.01\.2000/u)).toBeInTheDocument();
    });

    it("treats an unreadable timestamp as just used", () => {
      renderSettings({
        sessions: [{ ...SESSIONS[1], lastUsedAt: "garbage" } as SessionSummary],
      });

      expect(screen.getByText("Jetzt")).toBeInTheDocument();
    });
  });

  it("keeps the preferences in sync with the loader after a navigation", () => {
    const harness = renderSettings();

    harness.update({ navigation: { state: "loading" } });
    harness.update({ navigation: { state: "idle" } });

    expect(
      within(screen.getByRole("combobox", { name: "Sprache" })).getByText(
        "Deutsch",
      ),
    ).toBeInTheDocument();
  });
});
