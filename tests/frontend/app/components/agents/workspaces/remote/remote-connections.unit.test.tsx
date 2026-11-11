import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { RemoteConnectionsCard } from "@/app/components/agents/workspaces/remote/remote-connections-card";
import { RemoteConnectionRow } from "@/app/components/agents/workspaces/remote/remote-connection-row";
import { RemoteConnectionStatus } from "@/app/components/agents/workspaces/remote/remote-connection-status";
import { RemoteField } from "@/app/components/agents/workspaces/remote/remote-field";
import { RemoteTestPanel } from "@/app/components/agents/workspaces/remote/remote-test-panel";
import { useRemoteConnectionForm } from "@/app/components/agents/workspaces/remote/use-remote-connection-form";

import type {
  RemoteActionResult,
  RemoteConnectionView,
  RemoteHostKey,
  RemoteOverview,
  RemoteTestResult,
} from "@/definition/RemoteConnection";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  revalidate: vi.fn(),
  fetchers: [] as {
    state: string;
    data?: RemoteActionResult;
    submit: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock("react-router", () => ({
  useFetcher: () =>
    mocks.fetchers.shift() ?? {
      state: "idle",
      submit: mocks.submit,
      Form: "form",
    },
  useRevalidator: () => ({ revalidate: mocks.revalidate }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/app/components/common/region-provider", () => ({
  useRegionFormat: () => ({ locale: "en-US", timeZone: "UTC" }),
}));
vi.mock(
  "@/app/components/agents/workspaces/remote/remote-connection-dialog",
  () => ({
    RemoteConnectionDialog: (props: {
      connection: RemoteConnectionView | null;
      onClose: () => void;
    }) => (
      <button onClick={props.onClose}>
        {props.connection?.name ?? "new dialog"}
      </button>
    ),
  }),
);

const KEY: RemoteHostKey = {
  algorithm: "ssh-ed25519",
  key: "abc",
  fingerprint: "SHA256:test",
};
const CONNECTION: RemoteConnectionView = {
  id: "one",
  name: "Server",
  host: "example.test",
  port: 22,
  username: "ada",
  authMethod: "key",
  departmentId: "dept",
  departmentName: "Engineering",
  hostKey: KEY,
  allowedRoots: [],
  lastCheck: null,
  isChecking: false,
  session: {
    status: "idle",
    attempts: 0,
    maximumAttempts: 10,
    nextAttemptAt: null,
    cause: null,
    connectedAt: null,
  },
  workspaceCount: 2,
  revision: 4,
  canManage: false,
  canOpenConsole: false,
  storedSecrets: { password: false, privateKey: true, passphrase: false },
};
const OVERVIEW: RemoteOverview = {
  canManageConnections: true,
  connections: [],
  departments: [],
  workspaces: [],
  choices: [],
  installs: {},
};
const TEST: RemoteTestResult = {
  reachability: { state: "passed", code: null },
  hostKey: { state: "failed", code: "host_key_unconfirmed" },
  authentication: { state: "skipped", code: null },
  presentedHostKey: KEY,
  testedAt: "2026-01-01T00:00:00Z",
};

beforeEach(() => {
  mocks.fetchers = [];
  mocks.submit.mockReset();
  mocks.revalidate.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});

it("validates credentials and submits a confirmed key with the draft", () => {
  const close = vi.fn();
  const { result } = renderHook(() => useRemoteConnectionForm(null, close));
  expect(result.current.isComplete).toBe(false);
  act(() =>
    result.current.setDraft({
      ...result.current.draft,
      name: "Server",
      host: "host",
      username: "ada",
      departmentId: "dept",
      privateKey: "secret",
    }),
  );
  expect(result.current.isComplete).toBe(true);
  act(() => result.current.confirmHostKey(KEY));
  expect(mocks.submit).toHaveBeenCalledWith(
    {
      intent: "test-connection",
      connectionId: "",
      input: JSON.stringify({
        ...result.current.draft,
        port: 22,
        hostKey: "ssh-ed25519 abc",
      }),
    },
    { method: "post", action: "/agents/workspaces/remote" },
  );
  act(() => result.current.save());
  expect(mocks.submit).toHaveBeenLastCalledWith(
    {
      intent: "save-connection",
      connectionId: "",
      input: JSON.stringify({
        ...result.current.draft,
        port: 22,
        hostKey: "ssh-ed25519 abc",
      }),
    },
    { method: "post", action: "/agents/workspaces/remote" },
  );
  act(() => result.current.requestClose());
  expect(result.current.shouldConfirmClose).toBe(true);
  expect(close).not.toHaveBeenCalled();
});

it("uses stored credentials, guards dismissal, and closes after a successful save", () => {
  const close = vi.fn();
  const saver = {
    state: "idle",
    submit: mocks.submit,
    data: undefined as RemoteActionResult | undefined,
  };
  const tester = {
    state: "idle",
    submit: mocks.submit,
    data: undefined as RemoteActionResult | undefined,
  };
  mocks.fetchers = [saver, tester];
  const { result, rerender } = renderHook(() =>
    useRemoteConnectionForm(CONNECTION, close),
  );
  expect(result.current.isComplete).toBe(true);
  const event = { defaultPrevented: false, preventDefault: vi.fn() };
  act(() => result.current.guardDismiss(event));
  expect(event.preventDefault).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  saver.data = { ok: true, intent: "save-connection" };
  mocks.fetchers = [saver, tester];
  rerender();
  expect(close).toHaveBeenCalledTimes(2);
});

it("shows test stages and confirms the presented key", () => {
  const confirm = vi.fn();
  const { rerender } = render(
    <RemoteTestPanel
      test={TEST}
      result={undefined}
      isTesting={false}
      onConfirm={confirm}
    />,
  );
  expect(screen.getByText(/remote.failure.host_key_unconfirmed/)).toBeTruthy();
  expect(screen.getByText(/ED25519.*SHA256:test/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "remote.test.confirm" }));
  expect(confirm).toHaveBeenCalledWith(KEY);
  rerender(
    <RemoteTestPanel
      test={TEST}
      result={undefined}
      isTesting
      onConfirm={confirm}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("remote.dialog.testing");
});

it("renders connection statuses and a blocked reconnect form", () => {
  const { rerender } = render(
    <RemoteConnectionStatus connection={{ ...CONNECTION, hostKey: null }} />,
  );
  expect(screen.getByText("remote.status.unconfirmed")).toBeTruthy();
  expect(screen.getByText("remote.status.confirmHostKey")).toBeTruthy();
  rerender(
    <RemoteConnectionStatus
      connection={{
        ...CONNECTION,
        session: {
          ...CONNECTION.session,
          status: "blocked",
          cause: "transport_lost",
        },
      }}
    />,
  );
  expect(screen.getByText("remote.status.blocked")).toBeTruthy();
  expect(
    screen
      .getByRole("button", { name: "remote.connections.reconnect" })
      .closest("form")
      ?.querySelector('input[name="connectionId"]')
      ?.getAttribute("value"),
  ).toBe("one");
  rerender(
    <RemoteConnectionStatus
      connection={{
        ...CONNECTION,
        session: { ...CONNECTION.session, status: "connected" },
      }}
    />,
  );
  expect(screen.getByText("remote.status.connected")).toBeTruthy();
});

it("renders the connection row and associates a field label", () => {
  render(
    <>
      <table>
        <tbody>
          <RemoteConnectionRow
            connection={{ ...CONNECTION, departmentName: null }}
            install={undefined}
            hasActions={false}
            onEdit={vi.fn()}
          />
        </tbody>
      </table>
      <RemoteField id="host" label="Host">
        <input id="host" />
      </RemoteField>
    </>,
  );
  expect(screen.getByText("ada@example.test:22")).toBeTruthy();
  expect(screen.getByText("remote.connections.departmentRemoved")).toBeTruthy();
  expect(screen.getByLabelText("Host")).toBeTruthy();
});

it("opens and closes the new connection dialog and shows the table", () => {
  const { rerender } = render(<RemoteConnectionsCard overview={OVERVIEW} />);
  expect(screen.getByText("remote.connections.empty")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "remote.connections.add" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "new dialog" }));
  expect(screen.queryByText("new dialog")).toBeNull();
  rerender(
    <RemoteConnectionsCard
      overview={{ ...OVERVIEW, connections: [CONNECTION] }}
    />,
  );
  expect(screen.getByText("Server")).toBeTruthy();
  expect(screen.queryByText("remote.connections.columns.actions")).toBeNull();
});

it("polls active connections and stops after unmount", () => {
  vi.useFakeTimers();
  try {
    const connection: RemoteConnectionView = {
      ...CONNECTION,
      session: { ...CONNECTION.session, status: "reconnecting" },
    };
    const { unmount } = render(
      <RemoteConnectionsCard
        overview={{ ...OVERVIEW, connections: [connection] }}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(mocks.revalidate).toHaveBeenCalledTimes(2);
    unmount();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(mocks.revalidate).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("requires the selected authentication secret and a numeric port", () => {
  const { result } = renderHook(() => useRemoteConnectionForm(null, vi.fn()));
  const draft = {
    ...result.current.draft,
    name: "Server",
    host: "host",
    username: "ada",
    departmentId: "dept",
    authMethod: "key_passphrase" as const,
    privateKey: "key",
  };
  act(() => result.current.setDraft(draft));
  expect(result.current.isComplete).toBe(false);
  act(() => result.current.setDraft({ ...draft, passphrase: "phrase" }));
  expect(result.current.isComplete).toBe(true);
  act(() =>
    result.current.setDraft({
      ...draft,
      passphrase: "phrase",
      port: "invalid",
    }),
  );
  expect(result.current.isComplete).toBe(false);
  act(() =>
    result.current.setDraft({
      ...draft,
      authMethod: "password",
      password: "password",
    }),
  );
  expect(result.current.isComplete).toBe(true);
});
