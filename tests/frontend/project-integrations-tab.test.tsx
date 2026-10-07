// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();

  return {
    ...actual,
    useActionData: vi.fn(),
    useNavigation: vi.fn(),
  };
});

import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  RouterProvider,
  useActionData,
  useNavigation,
} from "react-router";

import { ProjectIntegrationsTab } from "@/app/components/projects/project-integrations-tab";
import { createI18n } from "@/app/lib/i18n";
import { LANGUAGE } from "@/language/Language";

import type { ProjectIntegration } from "@/definition/Project";

const mockedActionData = vi.mocked(useActionData);
const mockedNavigation = vi.mocked(useNavigation);

const OPEN_GITHUB = "Einstellungen für GitHub öffnen";

function createIntegration(
  overrides: Partial<ProjectIntegration> = {},
): ProjectIntegration {
  return {
    hasToken: true,
    isConnected: true,
    lastSyncAt: "2026-09-05 14:21",
    nextSyncAt: "2026-09-05 14:36",
    projectId: "project-1",
    repoName: "user/pages",
    repoUrl: "https://github.com/user/pages.git",
    syncComments: true,
    syncCommits: true,
    syncDirection: "bidirectional",
    syncEnabled: true,
    syncIntervalMinutes: 15,
    syncIssues: true,
    syncPullRequests: true,
    syncStatus: true,
    updatedAt: "2026-09-05",
    ...overrides,
  };
}

interface Rendered {
  readonly submissions: Record<string, string>[];
  /** Changes what the panel sees as action data, then renders again. */
  readonly rerender: (actionData: unknown) => void;
}

function renderTab(
  integration: ProjectIntegration | null,
  canWrite = true,
): Rendered {
  const submissions: Record<string, string>[] = [];

  async function action({ request }: { request: Request }): Promise<null> {
    const formData = await request.formData();

    submissions.push(
      Object.fromEntries(
        [...formData.entries()].map(([key, value]) => [key, String(value)]),
      ),
    );

    return null;
  }

  const router = createMemoryRouter(
    [
      {
        action,
        element: (
          <ProjectIntegrationsTab
            canWrite={canWrite}
            integration={integration}
            projectId="project-1"
          />
        ),
        path: "/",
      },
    ],
    { initialEntries: ["/"] },
  );

  const view = render(
    <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
      <RouterProvider router={router} />
    </I18nextProvider>,
  );

  return {
    rerender: (actionData) => {
      mockedActionData.mockReturnValue(actionData);
      act(() =>
        view.rerender(
          <I18nextProvider i18n={createI18n(LANGUAGE.GERMAN)}>
            <RouterProvider router={router} />
          </I18nextProvider>,
        ),
      );
    },
    submissions,
  };
}

function hiddenValue(name: string): string {
  return (document.querySelector(`input[name="${name}"]`) as HTMLInputElement)
    .value;
}

async function openGitHub(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: OPEN_GITHUB }));
}

beforeEach(() => {
  mockedActionData.mockReturnValue(undefined);
  mockedNavigation.mockReturnValue({
    state: "idle",
  } as ReturnType<typeof useNavigation>);
});

describe("ProjectIntegrationsTab cards", () => {
  it("offers GitHub and announces the other interfaces as planned", () => {
    renderTab(null);

    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getAllByText("In Planung")).toHaveLength(5);

    for (const name of [
      "Google Kalender",
      "Discord",
      "Webhooks",
      "E-Mail",
      "REST API",
    ]) {
      expect(screen.getByText(name)).toBeInTheDocument();
      expect(
        screen.queryByRole("button", {
          name: `Einstellungen für ${name} öffnen`,
        }),
      ).not.toBeInTheDocument();
    }

    expect(screen.getByText("Nicht verbunden")).toBeInTheDocument();
  });

  it("shows the connection state on the GitHub card", () => {
    renderTab(createIntegration());

    expect(screen.getByText("Verbunden")).toBeInTheDocument();
  });

  it("does not open a settings panel for a planned interface", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await user.click(screen.getByText("Discord"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the GitHub panel and closes it with the close button", async () => {
    const user = userEvent.setup();
    renderTab(null);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openGitHub(user);

    const dialog = screen.getByRole("dialog");

    expect(dialog).toHaveAccessibleName("Schnittstellen-Einstellungen");
    expect(screen.getByRole("button", { name: OPEN_GITHUB })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Panel schließen" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: OPEN_GITHUB })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("closes the panel with Escape unless the key was already handled", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);
    await user.keyboard("a");

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const handled = new KeyboardEvent("keydown", {
      cancelable: true,
      key: "Escape",
    });
    handled.preventDefault();
    document.dispatchEvent(handled);

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("GitHubPanel read-only", () => {
  it("explains the missing permission and offers no form", async () => {
    const user = userEvent.setup();
    renderTab(createIntegration(), false);

    await openGitHub(user);

    expect(
      screen.getByText(/Du hast Leserechte für dieses Projekt/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Integration speichern" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Verbindung testen" }),
    ).not.toBeInTheDocument();
  });
});

describe("GitHubPanel sync switch", () => {
  const SWITCH_NAME = "GitHub-Synchronisierung aktiv";

  it("posts the new state when the switch is toggled", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab(createIntegration());

    await openGitHub(user);
    await user.click(screen.getByRole("switch", { name: SWITCH_NAME }));
    await vi.waitFor(() => expect(submissions).toHaveLength(1));

    expect(submissions[0]).toEqual({
      intent: "set-integration-sync",
      syncEnabled: "",
    });
  });

  it("switches back on and disables the manual sync while off", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab(
      createIntegration({ syncEnabled: false }),
    );

    await openGitHub(user);

    expect(screen.getByRole("switch", { name: SWITCH_NAME })).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Jetzt synchronisieren" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("switch", { name: SWITCH_NAME }));
    await vi.waitFor(() => expect(submissions).toHaveLength(1));

    expect(submissions[0]).toEqual({
      intent: "set-integration-sync",
      syncEnabled: "on",
    });
  });

  it("keeps the manual sync available while on", async () => {
    const user = userEvent.setup();
    renderTab(createIntegration());

    await openGitHub(user);

    expect(
      screen.getByRole("button", { name: "Jetzt synchronisieren" }),
    ).toBeEnabled();
  });

  it.each([
    [true, "Synchronisierung ist aktiv."],
    [false, "Synchronisierung ist ausgeschaltet."],
  ])(
    "shows the state read-only without write access (%s)",
    async (isEnabled, text) => {
      const user = userEvent.setup();
      renderTab(createIntegration({ syncEnabled: isEnabled }), false);

      await openGitHub(user);

      expect(screen.getByRole("status")).toHaveTextContent(text);
      expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    },
  );

  it("hides the options without effect", async () => {
    const user = userEvent.setup();
    renderTab(createIntegration());

    await openGitHub(user);

    expect(screen.queryByText(/Webhook-URL/)).not.toBeInTheDocument();
    expect(screen.queryByText("Commits anzeigen")).not.toBeInTheDocument();
  });
});

describe("GitHubPanel read-only without a stored integration", () => {
  it("explains the missing permission for a project that is not connected", async () => {
    const user = userEvent.setup();
    renderTab(null, false);

    await openGitHub(user);

    expect(
      screen.getByText(/Du hast Leserechte für dieses Projekt/),
    ).toBeInTheDocument();
  });
});

describe("GitHubPanel without a stored integration", () => {
  it("starts clean with every sync switch on", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);

    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("GitHub Repository")).toHaveValue("");
    expect(hiddenValue("syncDirection")).toBe("bidirectional");
    expect(hiddenValue("syncStatus")).toBe("on");
    expect(hiddenValue("syncComments")).toBe("on");
    expect(hiddenValue("syncIssues")).toBe("on");
    expect(hiddenValue("syncPullRequests")).toBe("on");
    expect(hiddenValue("syncCommits")).toBe("on");
    expect(hiddenValue("syncIntervalMinutes")).toBe("15");
    expect(
      screen.queryByRole("button", { name: "Verbindung trennen" }),
    ).not.toBeInTheDocument();

    for (const switchControl of screen.getAllByRole("switch")) {
      expect(switchControl).toBeChecked();
    }
  });

  it("enables saving once the repository changes", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);
    await user.type(
      screen.getByLabelText("GitHub Repository"),
      "https://x.y/z",
    );

    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeEnabled();
  });

  it("enables saving once a token is typed and can reveal it", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);

    const token = screen.getByLabelText(
      "GitHub API Key / Personal Access Token",
    );

    expect(token).toHaveAttribute("type", "password");

    await user.type(token, "ghp_secret");
    await user.click(screen.getByRole("button", { name: "Token anzeigen" }));

    expect(token).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Token verbergen" }));

    expect(token).toHaveAttribute("type", "password");
  });

  it.each([
    ["Issues synchronisieren", "syncIssues"],
    ["Pull Requests synchronisieren", "syncPullRequests"],
  ])("tracks the %s switch in the form", async (name, field) => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);
    await user.click(screen.getByRole("switch", { name }));

    expect(screen.getByRole("switch", { name })).not.toBeChecked();
    expect(hiddenValue(field)).toBe("");
    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("switch", { name }));

    expect(hiddenValue(field)).toBe("on");
    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeDisabled();
  });

  it("only pulls once both create switches are off", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);
    await user.click(
      screen.getByRole("switch", { name: "GitHub Issues aus Pages erstellen" }),
    );

    expect(hiddenValue("syncDirection")).toBe("bidirectional");
    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeEnabled();

    await user.click(
      screen.getByRole("switch", {
        name: "Pull Requests aus Pages erstellen",
      }),
    );

    expect(hiddenValue("syncDirection")).toBe("pull");
  });

  it("detects a changed pull request create switch on its own", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);
    await user.click(
      screen.getByRole("switch", {
        name: "Pull Requests aus Pages erstellen",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeEnabled();
  });

  it("changes the interval and the branch", async () => {
    const user = userEvent.setup();
    renderTab(null);

    await openGitHub(user);
    await user.click(
      screen.getByRole("combobox", { name: "Aktualisierungsintervall" }),
    );
    await user.click(screen.getByRole("option", { name: "Manuell" }));

    expect(hiddenValue("syncIntervalMinutes")).toBe("0");
    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeEnabled();

    await user.click(screen.getByRole("combobox", { name: "Standard-Branch" }));
    await user.click(screen.getByRole("option", { name: "develop" }));

    expect(
      within(
        screen.getByRole("combobox", { name: "Standard-Branch" }),
      ).getByText("develop"),
    ).toBeInTheDocument();
  });

  it("submits the form with the typed values", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab(null);

    await openGitHub(user);
    await user.type(
      screen.getByLabelText("GitHub Repository"),
      "https://x.y/z",
    );
    await user.click(
      screen.getByRole("button", { name: "Integration speichern" }),
    );

    expect(submissions).toHaveLength(1);
    expect(submissions[0]).toMatchObject({
      intent: "save-integration",
      repoUrl: "https://x.y/z",
      syncDirection: "bidirectional",
    });
  });
});

describe("GitHubPanel with a stored integration", () => {
  it("keeps the stored token hidden until it is replaced", async () => {
    const user = userEvent.setup();
    renderTab(createIntegration());

    await openGitHub(user);

    expect(screen.getByText("✓ API-Key hinterlegt")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Token anzeigen" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "API-Key ersetzen" }));

    expect(
      screen.getByPlaceholderText("ghp_••••••••••••••••••••"),
    ).toBeInTheDocument();
    expect(screen.queryByText("✓ API-Key hinterlegt")).not.toBeInTheDocument();
  });

  it("shows the sync details and offers to sync or disconnect", async () => {
    const user = userEvent.setup();
    const { submissions } = renderTab(createIntegration());

    await openGitHub(user);

    expect(screen.getByText("user/pages")).toBeInTheDocument();
    expect(screen.getByText("2026-09-05 14:21")).toBeInTheDocument();
    expect(screen.getByText("2026-09-05 14:36")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Jetzt synchronisieren" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Verbindung trennen" }),
    );

    expect(submissions.map((submission) => submission.intent)).toEqual([
      "sync-integration",
      "disconnect-integration",
    ]);
  });

  it("falls back to placeholders for missing sync details", async () => {
    const user = userEvent.setup();
    renderTab(
      createIntegration({
        isConnected: false,
        lastSyncAt: null,
        nextSyncAt: null,
        repoName: null,
      }),
    );

    await openGitHub(user);

    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("Noch nie")).toBeInTheDocument();
    expect(screen.getAllByText("Manuell").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "Jetzt synchronisieren" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Nicht verbunden").length).toBeGreaterThan(1);
  });

  it("carries the stored switches and direction into the form", async () => {
    const user = userEvent.setup();
    renderTab(
      createIntegration({
        syncComments: false,
        syncCommits: false,
        syncDirection: "pull",
        syncIntervalMinutes: 30,
        syncIssues: false,
        syncPullRequests: false,
        syncStatus: false,
      }),
    );

    await openGitHub(user);

    expect(hiddenValue("syncStatus")).toBe("");
    expect(hiddenValue("syncComments")).toBe("");
    expect(hiddenValue("syncIssues")).toBe("");
    expect(hiddenValue("syncPullRequests")).toBe("");
    expect(hiddenValue("syncCommits")).toBe("");
    expect(hiddenValue("syncDirection")).toBe("pull");
    expect(hiddenValue("syncIntervalMinutes")).toBe("30");
    expect(
      screen.getByRole("switch", { name: "GitHub Issues aus Pages erstellen" }),
    ).not.toBeChecked();
  });

  it("keeps pushing for a push-only integration", async () => {
    const user = userEvent.setup();
    renderTab(createIntegration({ syncDirection: "push" }));

    await openGitHub(user);

    expect(hiddenValue("syncDirection")).toBe("bidirectional");
    expect(
      screen.getByRole("button", { name: "Integration speichern" }),
    ).toBeDisabled();
  });
});

describe("GitHubPanel pending and result states", () => {
  function submitting(intent: string): ReturnType<typeof useNavigation> {
    const formData = new FormData();

    formData.append("intent", intent);

    return { formData, state: "submitting" } as ReturnType<
      typeof useNavigation
    >;
  }

  it("marks a running save", async () => {
    const user = userEvent.setup();
    mockedNavigation.mockReturnValue(submitting("save-integration"));
    renderTab(createIntegration());

    await openGitHub(user);

    expect(
      screen.getByRole("button", { name: "Wird gespeichert …" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Verbindung testen" }),
    ).toBeEnabled();
  });

  it("marks a running connection test", async () => {
    const user = userEvent.setup();
    mockedNavigation.mockReturnValue(submitting("test-integration"));
    renderTab(createIntegration());

    await openGitHub(user);

    expect(
      screen.getByRole("button", { name: "Wird getestet …" }),
    ).toBeDisabled();
  });

  it("ignores other running submissions", async () => {
    const user = userEvent.setup();
    mockedNavigation.mockReturnValue(submitting("sync-integration"));
    renderTab(createIntegration());

    await openGitHub(user);

    expect(
      screen.getByRole("button", { name: "Verbindung testen" }),
    ).toBeEnabled();
  });

  it("reports the result of a connection test", async () => {
    const user = userEvent.setup();
    const { rerender, submissions } = renderTab(createIntegration());

    await openGitHub(user);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Verbindung testen" }));

    expect(submissions[0]).toMatchObject({ intent: "test-integration" });

    rerender({ ok: true });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Verbindung erfolgreich.",
    );

    rerender({ ok: false });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Verbindung fehlgeschlagen",
    );
  });

  it.each([
    ["no result", undefined],
    ["a null result", null],
    ["a text result", "failed"],
    ["a result without a flag", { error: "x" }],
    ["a result with a non-boolean flag", { ok: "yes" }],
  ])("shows nothing for %s", async (_label, actionData) => {
    const user = userEvent.setup();
    const { rerender } = renderTab(createIntegration());

    await openGitHub(user);
    await user.click(screen.getByRole("button", { name: "Verbindung testen" }));
    rerender(actionData);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows nothing while a navigation is still running", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTab(createIntegration());

    await openGitHub(user);
    await user.click(screen.getByRole("button", { name: "Verbindung testen" }));
    mockedNavigation.mockReturnValue({
      state: "loading",
    } as ReturnType<typeof useNavigation>);
    rerender({ ok: true });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("forgets the test result after saving", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTab(createIntegration());

    await openGitHub(user);
    await user.click(screen.getByRole("button", { name: "Verbindung testen" }));
    rerender({ ok: true });

    expect(screen.getByRole("status")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("GitHub Repository"), {
      target: { value: "https://x.y/z" },
    });
    await user.click(
      screen.getByRole("button", { name: "Integration speichern" }),
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
