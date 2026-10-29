import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { AgentCliLogin } from "@/app/components/settings/agents/agent-cli-login";
import { AgentLoginChallenge } from "@/app/components/settings/agents/agent-login-challenge";
import { createI18n } from "@/app/lib/i18n";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";
import { isPicaModel } from "@/definition/PicaModelSelection";

import type {
  AgentConnectionSummary,
  CliLoginState,
} from "@/definition/AgentConnection";
import type { AgentActions } from "@/app/components/settings/agents/use-agent-actions";

const CONNECTION: AgentConnectionSummary = {
  id: "synthetic-antigravity",
  name: "Google test account",
  provider: "antigravity",
  accessKind: "cli_account",
  isActive: true,
  hasApiKey: false,
  testModel: null,
  reasoningEffort: null,
  scope: GLOBAL_CONNECTION_SCOPE,
  cli: {
    binaryFound: true,
    loggedInAt: null,
    accountLabel: null,
    login: null,
    terminalCommand: "",
  },
  checks: { auth: null, model: null },
  updatedAt: "2026-10-29T00:00:00Z",
};
function actions(): AgentActions {
  return {
    isPending: false,
    pendingIntent: null,
    error: null,
    result: undefined,
    submit: vi.fn(),
  };
}

it.each(["de", "en"] as const)(
  "uses the existing login UI in %s and explains the execution-host callback and Pica block",
  (language) => {
    const onCommand = vi.fn();
    render(
      <I18nextProvider i18n={createI18n(language)}>
        <AgentCliLogin
          connection={CONNECTION}
          disabled={false}
          actions={actions()}
          onCommand={onCommand}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(/Loopback|loopback/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: language === "de" ? "Anmeldung starten" : "Start sign-in",
      }),
    );
    expect(onCommand).toHaveBeenCalledWith(CONNECTION, "login");
    expect(screen.queryByText(/settings\.agents\./)).toBeNull();
  },
);

it("shows the provider URL, no invented device/code form, and sends cancellation to the existing action", () => {
  const commands = actions();
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <AgentLoginChallenge
        connection={CONNECTION}
        actions={commands}
        login={{
          state: "awaiting_user",
          verificationUrl:
            "https://accounts.google.com/o/oauth2/auth?synthetic=1",
        }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByRole("link").getAttribute("href")).toContain(
    "https://accounts.google.com/",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(commands.submit).toHaveBeenCalledWith("cancel-login", CONNECTION.id);
});

it.each(["failed", "expired", "cancelled"] as const)(
  "offers another login after the simulated %s state",
  (state: CliLoginState) => {
    const connection = {
      ...CONNECTION,
      cli: {
        ...CONNECTION.cli,
        binaryFound: true,
        loggedInAt: null,
        accountLabel: null,
        terminalCommand: "",
        login: { state },
      },
    };
    render(
      <I18nextProvider i18n={createI18n("en")}>
        <AgentCliLogin
          connection={connection}
          disabled={false}
          actions={actions()}
          onCommand={vi.fn()}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("button", { name: /again/i })).toBeTruthy();
  },
);

it("retains logout for the isolated signed-in account and excludes unverified Pica choices", () => {
  const onCommand = vi.fn();
  const connection: AgentConnectionSummary = {
    ...CONNECTION,
    cli: {
      binaryFound: true,
      loggedInAt: "2026-10-29T00:00:00Z",
      accountLabel: "Synthetic Google",
      login: null,
      terminalCommand: "",
    },
  };
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={actions()}
        onCommand={onCommand}
      />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(onCommand).toHaveBeenCalledWith(connection, "logout");
  expect(
    isPicaModel({ provider: "antigravity", model: "confirmed-flash" }),
  ).toBe(false);
});

it("allows a status check without offering login or logout for an operator-bound account", () => {
  const onCommand = vi.fn();
  const connection: AgentConnectionSummary = {
    ...CONNECTION,
    cli: {
      binaryFound: true,
      loggedInAt: "2026-10-29T00:00:00Z",
      accountLabel: null,
      login: null,
      terminalCommand: "",
      isOperatorBound: true,
    },
  };
  render(
    <I18nextProvider i18n={createI18n("en")}>
      <AgentCliLogin
        connection={connection}
        disabled={false}
        actions={actions()}
        onCommand={onCommand}
      />
    </I18nextProvider>,
  );
  expect(
    screen.queryByRole("button", { name: /sign in|sign out/i }),
  ).toBeNull();
  expect(screen.getByText(/managed by the operator/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /check sign-in/i }));
  expect(onCommand).toHaveBeenCalledWith(connection, "auth");
});
