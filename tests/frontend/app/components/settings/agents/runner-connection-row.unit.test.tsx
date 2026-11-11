import { cleanup, render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { RunnerConnectionRow } from "@/app/components/settings/agents/runner-connection-row";
import { createI18n } from "@/app/lib/i18n";

import type { RunnerConnectionView } from "@/definition/RunnerProtocol";
import type { ToolInventory } from "@/definition/RemoteSetup";

interface FetcherState {
  data: unknown;
  state: "idle" | "submitting";
  Form: (props: React.ComponentProps<"form">) => React.ReactElement;
}

const fetcher = vi.hoisted((): FetcherState => ({
  data: undefined,
  state: "idle",
  Form: (props) => <form {...props} />,
}));

vi.mock("react-router", () => ({ useFetcher: () => fetcher }));

const i18n = createI18n("en");

/** A stable SSH connection without a runner unless the overrides say otherwise. */
function connection(
  overrides: Partial<RunnerConnectionView> = {},
): RunnerConnectionView {
  return {
    connectionId: "conn-1",
    name: "Build host",
    endpoint: "ci@build.example:22",
    departmentName: null,
    checkedAt: null,
    isStable: true,
    runnerId: null,
    isOnline: false,
    tools: null,
    ...overrides,
  };
}

function renderRow(view: RunnerConnectionView): HTMLElement {
  render(
    <I18nextProvider i18n={i18n}>
      <table>
        <tbody>
          <RunnerConnectionRow connection={view} />
        </tbody>
      </table>
    </I18nextProvider>,
  );
  return screen.getByRole("row");
}

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
});

afterEach(() => {
  vi.useRealTimers();
});

it("names the registration, its endpoint and an empty department", () => {
  const row = renderRow(connection({ departmentName: "Platform" }));
  const header = within(row).getByRole("rowheader");
  expect(header.textContent).toBe("Build hostci@build.example:22");
  expect(within(row).getByText("Platform")).toBeTruthy();
  expect(within(row).queryByText("Pages runner")).toBeNull();
});

it("shows a dash instead of a department when there is none", () => {
  const row = renderRow(connection());
  expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
});

it.each([
  [
    { needsPairing: true, runnerId: "r", isOnline: true },
    "Invalid identity – pair again",
  ],
  [{ runnerId: "r", isOnline: true }, "Runner connected"],
  [
    { runnerId: "r", isOnline: false },
    "Runner registered, currently offline or pairing outdated",
  ],
  [{ isStable: true }, "SSH stable · Runner missing"],
  [{ isStable: false }, "SSH connection is not stable yet."],
] as const)("shows the status of %j as %s", (overrides, label) => {
  const row = renderRow(connection(overrides));
  expect(within(row).getByText(label)).toBeTruthy();
});

it("marks only an online runner as active", () => {
  const online = renderRow(connection({ runnerId: "r", isOnline: true }));
  expect(within(online).getByText("Runner connected").className).toContain(
    "text-success",
  );
});

it("shows nothing for tools until the runner reported an inventory", () => {
  const row = renderRow(connection({ runnerId: "r", tools: null }));
  expect(within(row).getByText("Pages runner")).toBeTruthy();
  expect(within(row).queryByRole("list")).toBeNull();
  expect(within(row).queryByText("No tools found")).toBeNull();
});

it("says that an empty inventory found no tools", () => {
  const row = renderRow(connection({ runnerId: "r", tools: [] }));
  expect(within(row).getByText("No tools found")).toBeTruthy();
});

it("lists each tool with its version, an unknown version and its login", () => {
  const tools: ToolInventory[] = [
    { tool: "codex", version: "1.2.3", authentication: "authenticated" },
    { tool: "claude", version: null, authentication: "not_logged_in" },
    { tool: "antigravity", version: "0.9.0" },
  ];
  const row = renderRow(connection({ runnerId: "r", tools }));
  const items = within(within(row).getByRole("list")).getAllByRole("listitem");
  expect(items.map((item) => item.textContent)).toEqual([
    "Codex 1.2.3 · signed in",
    "Claude Code version unknown · not signed in",
    "Antigravity ACP 0.9.0",
  ]);
});

it("adds the OpenCode ACP facts and providers to its entry", () => {
  const tools: ToolInventory[] = [
    {
      tool: "opencode",
      version: "1.4.0",
      acp: { status: "incompatible", reason: "protocol_mismatch" },
      providers: ["opencode", "openrouter"],
    },
  ];
  const row = renderRow(connection({ runnerId: "r", tools }));
  const item = within(row).getByRole("listitem");
  expect(item.textContent).toContain("OpenCode 1.4.0");
  expect(item.textContent).toContain(
    "ACP contract checked: not compatible (different ACP protocol version).",
  );
  expect(item.textContent).toContain("opencode, openrouter");
});

it("asks to update a runner whose OpenCode entry has no ACP result", () => {
  const row = renderRow(
    connection({
      runnerId: "r",
      tools: [{ tool: "opencode", version: "1.0.0" }],
    }),
  );
  expect(
    within(row).getByText(/Update runner: OpenCode over ACP/u),
  ).toBeTruthy();
});

it("warns that an old output journal has a cumulative cap", () => {
  const row = renderRow(connection({ runnerId: "r", outputJournalVersion: 1 }));
  expect(
    within(row).getByText(/Runner 1\.9\.0 required: This runner still limits/u),
  ).toBeTruthy();
});

it("does not warn about the output cap on the current journal", () => {
  const row = renderRow(connection({ runnerId: "r", outputJournalVersion: 2 }));
  expect(
    within(row).queryByText(/still limits cumulative CLI output/u),
  ).toBeNull();
});

it("tells a reconciled runner without the 1.10 contract to update, naming its version", () => {
  const row = renderRow(
    connection({
      runnerId: "r",
      outputJournalVersion: 2,
      communicationVersion: null,
      runnerVersion: "1.9.4",
    }),
  );
  expect(
    within(row).getByText(
      "Runner 1.9.4: new remote runs require Runner 1.11 or newer. Running jobs are still reconciled; update it explicitly.",
    ),
  ).toBeTruthy();
});

it("names a runner that reports no version as older than 1.10", () => {
  const row = renderRow(
    connection({
      runnerId: "r",
      outputJournalVersion: 2,
      communicationVersion: null,
      runnerVersion: null,
    }),
  );
  expect(within(row).getByText(/Runner older than 1\.10:/u)).toBeTruthy();
});

it.each([
  ["no runner yet", { outputJournalVersion: 2, communicationVersion: null }],
  ["no reconciled journal", { runnerId: "r", communicationVersion: null }],
  [
    "the current communication contract",
    { runnerId: "r", outputJournalVersion: 2, communicationVersion: 1 },
  ],
] as const)("shows no communication upgrade for %s", (label, overrides) => {
  const row = renderRow(connection(overrides));
  expect(
    within(row).queryByText(/new remote runs require Runner/u),
    label,
  ).toBeNull();
});

it("shows a recent check relatively and keeps the exact time as title", () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  const row = renderRow(connection({ checkedAt: "2026-06-01T11:00:00.000Z" }));
  const time = row.querySelector("time");
  expect(time?.textContent).toBe("1 hour ago");
  expect(time?.getAttribute("dateTime")).toBe("2026-06-01T11:00:00.000Z");
});

it("says that a connection was never checked", () => {
  const row = renderRow(connection({ checkedAt: null }));
  expect(within(row).getByText("Not checked yet")).toBeTruthy();
});

it("offers setup for a stable connection without a runner, and only transfers", () => {
  const row = renderRow(connection());
  const setup = within(row).getByRole("button", { name: "Setup" });
  expect(setup.getAttribute("name")).toBe("intent");
  expect(setup.getAttribute("value")).toBe("transfer");
  expect(within(row).getByText(/Transfers pages_setup\.sh/u)).toBeTruthy();
  expect(within(row).queryByRole("button", { name: "Connect" })).toBeNull();
  const form = setup.closest("form");
  expect(form?.getAttribute("action")).toBe("/settings-api/runners");
  expect(form?.getAttribute("method")).toBe("post");
  expect(
    (form?.querySelector("input[name=connectionId]") as HTMLInputElement).value,
  ).toBe("conn-1");
});

it("offers connect for an unstable connection and no setup", () => {
  const row = renderRow(connection({ isStable: false }));
  const connect = within(row).getByRole("button", { name: "Connect" });
  expect(connect.getAttribute("value")).toBe("connect");
  expect(within(row).queryByRole("button", { name: "Setup" })).toBeNull();
  expect(within(row).queryByText(/Transfers pages_setup\.sh/u)).toBeNull();
});

it("offers no setup once a runner is registered", () => {
  const row = renderRow(connection({ runnerId: "r", isOnline: true }));
  expect(within(row).queryByRole("button", { name: "Setup" })).toBeNull();
  expect(
    within(row).getByRole("button", { name: "Revoke pairing" }),
  ).toBeTruthy();
});

it("disables the actions while a request is pending", () => {
  fetcher.state = "submitting";
  const row = renderRow(connection());
  expect(
    within(row).getByRole("button", { name: "Setup" }).hasAttribute("disabled"),
  ).toBe(true);
});

it("confirms a transfer with its path and a connect without one", () => {
  fetcher.data = {
    ok: true,
    intent: "transfer",
    path: "/home/ci/pages_setup.sh",
  };
  const view = renderRow(connection());
  expect(
    within(view).getByText(
      "Transferred and verified: /home/ci/pages_setup.sh. The script was not started.",
    ),
  ).toBeTruthy();
  cleanup();
  fetcher.data = { ok: true, intent: "connect" };
  const second = renderRow(connection({ isStable: false }));
  expect(
    within(second).getByText(
      "SSH connected. Setup appears after the stability check.",
    ),
  ).toBeTruthy();
});

it("reports a failed action without the path", () => {
  fetcher.data = { ok: false, path: "/secret/path" };
  const row = renderRow(connection());
  expect(
    within(row).getByText(
      "Action failed. Check connection, host key, permissions and existing destination file.",
    ),
  ).toBeTruthy();
  expect(row.textContent).not.toContain("/secret/path");
});
