import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentDeleteDialog } from "@/app/components/users/agents/agent-delete-dialog";
import { AgentDeletedList } from "@/app/components/users/agents/agent-deleted-list";
import { createI18n } from "@/app/lib/i18n";

import { resetRouter, router, submittedFields } from "./agent-router-mock";

import type { AgentDeletionPreview } from "@/definition/AgentDeletion";

vi.mock("react-router", async (importOriginal) => {
  const { withMockedRouter } = await import("./agent-router-mock");
  return withMockedRouter(await importOriginal<object>());
});

const i18n = createI18n("en");
const preview: AgentDeletionPreview = {
  agentId: "agent/1",
  displayName: "Ada",
  previewId: "preview-1",
  expiresAt: "2027-01-01T00:00:00Z",
  blockers: [],
  deletes: {
    directChats: 1,
    sessions: 2,
    memoryEntries: 0,
    ownedPlans: 0,
    runs: 0,
    files: 0,
    credentials: 0,
    groupMemberships: 0,
    assignedTickets: 0,
  },
  keeps: { groupChatMessages: 0, ticketChanges: 0, wikiChanges: 0, commits: 0 },
  ownedPlans: [],
};

beforeEach(() => resetRouter());
afterEach(() => vi.unstubAllGlobals());

it("loads a deletion preview and submits its identifier on confirmation", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => preview });
  vi.stubGlobal("fetch", fetchMock);
  render(
    <I18nextProvider i18n={i18n}>
      <AgentDeleteDialog agentId="agent/1" onClose={vi.fn()} />
    </I18nextProvider>,
  );
  const confirm = screen.getByRole("button", {
    name: i18n.t("agentEmployees.deletion.confirm"),
  });
  expect(confirm.hasAttribute("disabled")).toBe(true);
  await screen.findByText(/Ada/);
  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    "/users-api/agents/agent%2F1/deletion-preview",
  );
  fireEvent.click(confirm);
  expect(submittedFields(0)).toMatchObject({
    intent: "delete-agent",
    agentId: "agent/1",
    previewId: "preview-1",
  });
  expect(submittedFields(0).operationId).toEqual(expect.any(String));
});

it("prevents confirmation when the preview has a blocker", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ...preview,
        blockers: [
          { code: "active_runs", detail: "Running plan", link: "/plans/1" },
        ],
      }),
    }),
  );
  render(
    <I18nextProvider i18n={i18n}>
      <AgentDeleteDialog agentId="agent/1" onClose={vi.fn()} />
    </I18nextProvider>,
  );
  expect(
    (await screen.findByRole("link", { name: "Running plan" })).getAttribute(
      "href",
    ),
  ).toBe("/plans/1");
  expect(
    screen
      .getByRole("button", { name: i18n.t("agentEmployees.deletion.confirm") })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(router.submit).not.toHaveBeenCalled();
});

it("reports an invalid preview and allows cancellation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
  );
  const close = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <AgentDeleteDialog agentId="agent/1" onClose={close} />
    </I18nextProvider>,
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    i18n.t("agentEmployees.deletion.loadFailed"),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("agentEmployees.deletion.cancel"),
    }),
  );
  expect(close).toHaveBeenCalledOnce();
});

it("lists deleted agents and submits a restore", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        agents: [
          {
            agentId: "a1",
            displayName: "Ada",
            restorableUntil: "2099-01-01T00:00:00Z",
          },
        ],
      }),
    }),
  );
  render(
    <I18nextProvider i18n={i18n}>
      <AgentDeletedList />
    </I18nextProvider>,
  );
  await screen.findByText("Ada");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("agentEmployees.deletion.restore"),
    }),
  );
  expect(submittedFields(0)).toMatchObject({
    intent: "restore-agent",
    agentId: "a1",
  });
  expect(submittedFields(0).operationId).toEqual(expect.any(String));
});

it("reports a failed deleted-agent request", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: false, json: async () => ({ agents: [] }) }),
  );
  render(
    <I18nextProvider i18n={i18n}>
      <AgentDeletedList />
    </I18nextProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe(
      i18n.t("agentEmployees.deletion.loadFailed"),
    ),
  );
  expect(
    screen.queryByText(i18n.t("agentEmployees.deletion.noDeleted")),
  ).toBeNull();
});

it("closes only after a successful deletion of the displayed agent", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => preview }),
  );
  const close = vi.fn();
  const view = render(
    <I18nextProvider i18n={i18n}>
      <AgentDeleteDialog agentId="agent/1" onClose={close} />
    </I18nextProvider>,
  );
  await screen.findByText(/Ada/);
  router.actionData = { ok: true, intent: "delete-agent", agentId: "other" };
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <AgentDeleteDialog agentId="agent/1" onClose={close} />
    </I18nextProvider>,
  );
  expect(close).not.toHaveBeenCalled();
  router.actionData = { ok: true, intent: "delete-agent", agentId: "agent/1" };
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <AgentDeleteDialog agentId="agent/1" onClose={close} />
    </I18nextProvider>,
  );
  expect(close).toHaveBeenCalledOnce();
});

it("shows a failed preview request and keeps deletion disabled", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(
    <I18nextProvider i18n={i18n}>
      <AgentDeleteDialog agentId="agent/1" onClose={vi.fn()} />
    </I18nextProvider>,
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    i18n.t("agentEmployees.deletion.loadFailed"),
  );
  expect(
    screen
      .getByRole("button", { name: i18n.t("agentEmployees.deletion.confirm") })
      .hasAttribute("disabled"),
  ).toBe(true);
  expect(warning).toHaveBeenCalledOnce();
  warning.mockRestore();
});

it("refreshes the deleted list after a restore succeeds", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        agents: [
          {
            agentId: "a1",
            displayName: "Ada",
            restorableUntil: "2099-01-01T00:00:00Z",
          },
        ],
      }),
    })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ agents: [] }) });
  vi.stubGlobal("fetch", fetchMock);
  const view = render(
    <I18nextProvider i18n={i18n}>
      <AgentDeletedList />
    </I18nextProvider>,
  );
  await screen.findByText("Ada");
  router.actionData = { ok: true, intent: "restore-agent" };
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <AgentDeletedList />
    </I18nextProvider>,
  );
  expect(
    await screen.findByText(i18n.t("agentEmployees.deletion.noDeleted")),
  ).toBeTruthy();
  expect(screen.queryByText("Ada")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
