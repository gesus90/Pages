// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { RegionProvider } from "@/app/components/common/region-provider";
import { AgentCheckResults } from "@/app/components/settings/agents/agent-check-results";
import { AgentCheckTime } from "@/app/components/settings/agents/agent-check-time";
import {
  AgentStatus,
  agentStatus,
  latestAgentCheck,
} from "@/app/components/settings/agents/agent-status";
import { createI18n } from "@/app/lib/i18n";

import { createAgentConnection, createCliConnection } from "../helpers/agents";

import type {
  AgentCheckSummary,
  AgentCliState,
} from "@/definition/AgentConnection";
import type { ReactNode } from "react";

const PASSED: AgentCheckSummary = {
  status: "passed",
  errorCode: null,
  checkedAt: "2026-10-08T10:00:00Z",
  durationMs: 12,
  detail: {},
};
const FAILED: AgentCheckSummary = {
  ...PASSED,
  status: "failed",
  errorCode: "provider_auth_failed",
  checkedAt: "2026-10-08T11:00:00Z",
};

function show(children: ReactNode): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={createI18n("en")}>{children}</I18nextProvider>,
  );
}

function cli(overrides: Partial<AgentCliState> = {}): AgentCliState {
  return {
    binaryFound: true,
    loggedInAt: null,
    accountLabel: null,
    login: null,
    terminalCommand: "synthetic",
    ...overrides,
  };
}

describe("connection evidence", () => {
  it("keeps key presence, login, access and model results distinct", () => {
    const cases = [
      [createAgentConnection(), "unchecked"],
      [createCliConnection({ cli: cli({ binaryFound: false }) }), "missing"],
      [
        createCliConnection({ cli: cli({ login: { state: "starting" } }) }),
        "loginRunning",
      ],
      [createCliConnection(), "loginNeeded"],
      [
        createCliConnection({ cli: cli({ loggedInAt: PASSED.checkedAt }) }),
        "authenticated",
      ],
      [
        createAgentConnection({ checks: { auth: PASSED, model: null } }),
        "authenticated",
      ],
      [
        createAgentConnection({ checks: { auth: null, model: PASSED } }),
        "tested",
      ],
      [
        createAgentConnection({ checks: { auth: FAILED, model: PASSED } }),
        "failed",
      ],
      [
        createAgentConnection({ checks: { auth: PASSED, model: FAILED } }),
        "failed",
      ],
      [
        createAgentConnection({
          checks: {
            auth: PASSED,
            model: { ...PASSED, checkedAt: "2026-10-08T12:00:00Z" },
          },
        }),
        "tested",
      ],
      [
        createCliConnection({ cli: cli({ login: { state: "failed" } }) }),
        "loginNeeded",
      ],
    ] as const;
    expect(
      agentStatus(
        createAgentConnection({
          checks: {
            auth: { ...PASSED, checkedAt: "2026-10-08T12:00:00Z" },
            model: PASSED,
          },
        }),
      ),
    ).toBe("authenticated");
    for (const [connection, expected] of cases)
      expect(agentStatus(connection)).toBe(expected);
    expect(latestAgentCheck(createAgentConnection())).toBeNull();
    expect(
      latestAgentCheck(
        createAgentConnection({ checks: { auth: FAILED, model: PASSED } }),
      ),
    ).toBe(FAILED);
  });

  it("shows localized status icons and the most recent safe error", () => {
    const { rerender } = show(
      <AgentStatus connection={createAgentConnection()} />,
    );
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    rerender(
      <I18nextProvider i18n={createI18n("en")}>
        <AgentStatus
          connection={createAgentConnection({
            checks: { auth: FAILED, model: PASSED },
          })}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("Check failed")).toBeInTheDocument();
    expect(
      screen.getByText("The provider rejected the API key."),
    ).toBeInTheDocument();
    rerender(
      <I18nextProvider i18n={createI18n("en")}>
        <AgentStatus
          connection={createCliConnection({
            cli: cli({ loggedInAt: PASSED.checkedAt }),
          })}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    rerender(
      <I18nextProvider i18n={createI18n("en")}>
        <AgentStatus
          connection={createCliConnection({
            cli: cli({ login: { state: "verifying" } }),
          })}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("Signing in")).toBeInTheDocument();
    rerender(
      <I18nextProvider i18n={createI18n("en")}>
        <AgentStatus
          connection={createAgentConnection({
            checks: { auth: { ...FAILED, errorCode: null }, model: null },
          })}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("Check failed")).toBeInTheDocument();
  });

  it("keeps region-formatted timestamps alongside relative age", () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T10:05:00Z"));
    // A chosen zone keeps the expected clock times independent of the machine.
    show(
      <RegionProvider region={{ dateFormat: "DD.MM.YYYY", timezone: "UTC" }}>
        <AgentCheckTime checkedAt={null} />
        <AgentCheckTime checkedAt="unreadable" />
        <AgentCheckTime checkedAt={PASSED.checkedAt} />
        <AgentCheckTime checkedAt="2026-10-08T08:05:00Z" />
        <AgentCheckTime checkedAt="2026-10-05T10:05:00Z" />
        <AgentCheckTime checkedAt="2026-09-28T10:05:00Z" />
      </RegionProvider>,
    );
    // A missing value shows the dash and keeps a spoken label.
    expect(screen.getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Not checked yet")).toHaveClass("sr-only");
    expect(screen.getByText("unreadable")).toBeInTheDocument();
    expect(screen.getByText("5 minutes ago")).toHaveAttribute(
      "title",
      "08.10.2026 10:00",
    );
    expect(screen.getByText("2 hours ago")).toBeInTheDocument();
    expect(screen.getByText("3 days ago")).toBeInTheDocument();
    // After a week the list shows the short date instead of a relative age.
    expect(screen.getByText("28.09.2026")).toHaveAttribute(
      "title",
      "28.09.2026 10:05",
    );
  });

  it("renders a deterministic SSR timestamp and refreshes relative age after hydration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:05:00Z"));
    const content = (
      <I18nextProvider i18n={createI18n("en")}>
        <AgentCheckTime checkedAt={PASSED.checkedAt} />
      </I18nextProvider>
    );
    expect(renderToString(content)).toContain("08.10.2026 10:00");
    const view = render(content);
    expect(screen.getByText("5 minutes ago")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByText("6 minutes ago")).toBeInTheDocument();
    view.unmount();
    vi.useRealTimers();
  });

  it("renders access and model results separately with safe numerical details", () => {
    show(
      <>
        <AgentCheckResults kind="auth" check={null} isCli={false} />
        <AgentCheckResults
          kind="model"
          isCli={false}
          check={{
            ...PASSED,
            detail: {
              modelCount: 213,
              model: "sample",
              costUsd: 0.000001,
              hasMoreModels: true,
              isFreeTier: false,
            },
          }}
        />
        <AgentCheckResults kind="auth" check={FAILED} isCli={false} />
        <AgentCheckResults kind="auth" check={null} isCli />
        <AgentCheckResults kind="model" check={null} isCli />
      </>,
    );
    // API and CLI evidence are named like the actions that produced it.
    expect(
      screen.getAllByRole("heading").map((heading) => heading.textContent),
    ).toEqual([
      "Access check",
      "Model test",
      "Access check",
      "Sign-in status",
      "CLI test",
    ]);
    expect(screen.getAllByText("Not checked yet")).toHaveLength(3);
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByText("213")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
    expect(screen.getByText("0.000001")).toBeInTheDocument();
    expect(screen.getByText("sample")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The provider rejected the API key.",
    );
  });
});
