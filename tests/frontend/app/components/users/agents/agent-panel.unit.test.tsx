import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentPanel } from "@/app/components/users/agents/agent-panel";
import { createI18n } from "@/app/lib/i18n";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";

import {
  activityEntry,
  syntheticAgent,
  syntheticDetail,
} from "./agent-detail-fixture";
import { resetRouter, router, submittedFields } from "./agent-router-mock";

import type { Mock } from "vitest";
import type { AgentEmployeeDetailData } from "@/definition/AgentEmployeePage";
import type { UserRole } from "@/definition/Authorization";
import type { PageAgentModel } from "@/definition/PageAgent";

vi.mock("react-router", async (importOriginal) => {
  const { withMockedRouter } = await import("./agent-router-mock");
  return withMockedRouter(await importOriginal<object>());
});

const i18n = createI18n("de");

const MODEL: PageAgentModel = {
  id: agentModelKey("connection-1", "model-one"),
  connectionId: "connection-1",
  name: "Model One",
  model: "model-one",
  reasoning: "none",
  reasoningEfforts: [],
  catalogDefaultReasoningEffort: null,
  reasoningEffort: null,
  provider: "codex_cli",
};
const ROLES = [
  {
    id: "role-admin",
    name: "Lead",
    rank: 1,
    departmentBound: false,
    permissions: [],
  },
  {
    id: "role-member",
    name: "Member",
    rank: 2,
    departmentBound: false,
    permissions: [],
  },
] as const;

interface PanelOptions {
  readonly agentId?: string | null;
  readonly isOpen?: boolean;
  readonly canManageTemplates?: boolean;
  readonly roles?: readonly UserRole[];
}

function detailAnswer(detail: AgentEmployeeDetailData): Response {
  return new Response(JSON.stringify(detail), { status: 200 });
}

function ui(
  options: PanelOptions,
  onOpenChange: (isOpen: boolean) => void,
): React.ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <AgentPanel
          isOpen={options.isOpen ?? true}
          onOpenChange={onOpenChange}
          agentId={options.agentId === undefined ? null : options.agentId}
          models={[MODEL]}
          roles={options.roles ?? ROLES}
          departments={[{ id: "dep-1", name: "Engineering" }]}
          templates={{
            templates: [],
            canManage: options.canManageTemplates ?? false,
          }}
          voice={{ status: "noModel", model: null }}
        />
      </MemoryRouter>
    </I18nextProvider>
  );
}

function renderPanel(options: PanelOptions = {}): {
  readonly onOpenChange: Mock<(isOpen: boolean) => void>;
  readonly rerender: () => void;
} {
  const onOpenChange = vi.fn<(isOpen: boolean) => void>();
  const view = render(ui(options, onOpenChange));
  return {
    onOpenChange,
    rerender: () => view.rerender(ui(options, onOpenChange)),
  };
}

function stubFetch(
  ...details: readonly AgentEmployeeDetailData[]
): Mock<typeof fetch> {
  const fetchMock = vi.fn<typeof fetch>();
  for (const detail of details)
    fetchMock.mockResolvedValueOnce(detailAnswer(detail));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function tab(name: string): HTMLElement {
  return screen.getByRole("tab", {
    name: i18n.t(`agentEmployees.tabs.${name}`),
  });
}

function openTab(name: string): void {
  fireEvent.mouseDown(tab(name));
}

function saveButton(label: "create" | "save"): HTMLButtonElement {
  return screen.getByRole("button", {
    name: i18n.t(`agentEmployees.panel.${label}`),
  });
}

function field(label: string): HTMLInputElement {
  return screen.getByLabelText(i18n.t(`agentEmployees.fields.${label}`));
}

beforeEach(resetRouter);
afterEach(() => {
  vi.unstubAllGlobals();
});

it("creates a new agent with the last role, the soul template and no activity tab", () => {
  const fetchMock = stubFetch();
  renderPanel();
  expect(
    screen.getByText(i18n.t("agentEmployees.panel.createTitle")),
  ).toBeDefined();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("tab", { name: i18n.t("agentEmployees.tabs.activity") }),
  ).toBeNull();
  fireEvent.change(field("name"), { target: { value: "Grace" } });
  fireEvent.change(field("username"), { target: { value: "grace" } });
  fireEvent.change(field("position"), { target: { value: "Reviewer" } });
  fireEvent.click(saveButton("create"));
  expect(router.submit).toHaveBeenCalledTimes(1);
  expect(router.submit.mock.calls[0]?.[1]).toEqual({
    method: "post",
    encType: "multipart/form-data",
  });
  const fields = submittedFields(0);
  expect(fields.intent).toBe("create-agent");
  expect("agentId" in fields).toBe(false);
  expect("revision" in fields).toBe(false);
  expect("avatar" in fields).toBe(false);
  expect(JSON.parse(String(fields.agent))).toMatchObject({
    displayName: "Grace",
    username: "grace",
    position: "Reviewer",
    roleId: "role-member",
    connectionId: "",
    model: "",
    access: "read_only",
    soul: i18n.t("agentEmployees.soul.template"),
    instructions: "",
    isLearningEnabled: true,
  });
});

it("keeps the edits of every tab in one draft", () => {
  renderPanel();
  openTab("soul");
  const soul = screen.getByRole("textbox");
  expect(soul).toHaveProperty("value", i18n.t("agentEmployees.soul.template"));
  fireEvent.change(soul, { target: { value: "New soul" } });
  openTab("instructions");
  const instructions = screen.getByRole("textbox", { name: /AGENT\.md/u });
  fireEvent.change(instructions, { target: { value: "Do the work" } });
  openTab("memory");
  fireEvent.click(saveButton("create"));
  expect(JSON.parse(String(submittedFields(0).agent))).toMatchObject({
    soul: "New soul",
    instructions: "Do the work",
  });
});

it("reads the agent, enables editing and saves it with id and revision", async () => {
  const fetchMock = stubFetch(syntheticDetail());
  renderPanel({ agentId: "agent-1" });
  expect(
    screen.getByText(i18n.t("agentEmployees.panel.editTitle")),
  ).toBeDefined();
  expect(saveButton("save").disabled).toBe(true);
  await screen.findByDisplayValue("Ada Agent");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(saveButton("save").disabled).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.change(field("position"), { target: { value: "Lead coder" } });
  fireEvent.click(saveButton("save"));
  const fields = submittedFields(0);
  expect(fields).toMatchObject({
    intent: "update-agent",
    agentId: "agent-1",
    revision: "3",
  });
  expect(JSON.parse(String(fields.agent))).toMatchObject({
    displayName: "Ada Agent",
    position: "Lead coder",
    connectionId: "connection-1",
    model: "model-one",
    roleId: "role-1",
    soul: "Calm soul",
  });
});

it("shows the activity tab of a loaded agent with its entries", async () => {
  stubFetch(
    syntheticDetail({
      activity: [
        activityEntry({
          kind: "ticket",
          detail: JSON.stringify({ message: "PAGE-9 Done" }),
        }),
      ],
    }),
  );
  renderPanel({ agentId: "agent-1" });
  await screen.findByDisplayValue("Ada Agent");
  openTab("activity");
  expect(screen.getByText("Ticket: PAGE-9 Done")).toBeDefined();
  expect(screen.getByText(/^Diesen Monat: 1,50\s\$$/u)).toBeDefined();
});

it("keeps a read-only agent locked", async () => {
  stubFetch(syntheticDetail({ canEdit: false }));
  renderPanel({ agentId: "agent-1" });
  await screen.findByDisplayValue("Ada Agent");
  expect(saveButton("save").disabled).toBe(true);
  expect(field("name").disabled).toBe(true);
});

it("tells when the agent could not be read and keeps saving locked", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockRejectedValue(new Error("down")),
  );
  renderPanel({ agentId: "agent-1" });
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe(i18n.t("agentEmployees.panel.loadFailed"));
  expect(saveButton("save").disabled).toBe(true);
});

it("reads nothing while the panel is closed", () => {
  const fetchMock = stubFetch(syntheticDetail());
  renderPanel({ agentId: "agent-1", isOpen: false });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("closes through the cancel button", () => {
  const { onOpenChange } = renderPanel();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("users.create.cancel") }),
  );
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("closes after a new successful answer of its own intent only", () => {
  const { onOpenChange, rerender } = renderPanel();
  router.actionData = { ok: true, intent: "update-agent" };
  rerender();
  expect(onOpenChange).not.toHaveBeenCalled();
  router.actionData = { ok: true, intent: "create-agent" };
  rerender();
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

it("shows the refusal of the save in the footer and the pending state", () => {
  router.actionData = {
    ok: false,
    intent: "create-agent",
    error: "usernameTaken",
  };
  const { rerender } = renderPanel();
  const footer = screen.getByRole("contentinfo");
  expect(within(footer).getByRole("alert").textContent).toBe(
    i18n.t("users.error.usernameTaken"),
  );
  expect(saveButton("create").disabled).toBe(false);
  router.state = "submitting";
  router.formData = new FormData();
  router.formData.set("intent", "create-agent");
  rerender();
  expect(saveButton("create").disabled).toBe(true);
});

it("shows a refused memory restore in the memory tab", () => {
  router.actionData = {
    ok: false,
    intent: "restore-agent-memory",
    error: "conflict",
  };
  renderPanel();
  openTab("memory");
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("users.error.conflict"),
  );
});

it("reads the agent again after a memory version was restored and resets the draft", async () => {
  const fetchMock = stubFetch(
    syntheticDetail(),
    syntheticDetail({
      agent: syntheticAgent({ displayName: "Ada Restored", revision: 4 }),
    }),
  );
  const { rerender } = renderPanel({ agentId: "agent-1" });
  await screen.findByDisplayValue("Ada Agent");
  fireEvent.change(field("name"), { target: { value: "Unsaved" } });
  router.actionData = {
    ok: false,
    intent: "restore-agent-memory",
    error: "conflict",
  };
  rerender();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  router.actionData = { ok: true, intent: "restore-agent-memory" };
  rerender();
  await screen.findByDisplayValue("Ada Restored");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fireEvent.click(saveButton("save"));
  expect(submittedFields(0).revision).toBe("4");
});

it("previews a picked image, sends it and releases the preview on replacement", () => {
  const createUrl = vi.fn<(file: Blob) => string>();
  createUrl
    .mockReturnValueOnce("blob:first")
    .mockReturnValueOnce("blob:second");
  const revokeUrl = vi.fn<(url: string) => void>();
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: createUrl,
      revokeObjectURL: revokeUrl,
    }),
  );
  renderPanel();
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Missing file input");
  const first = new File(["a"], "a.png", { type: "image/png" });
  const second = new File(["b"], "b.png", { type: "image/png" });
  fireEvent.change(input, { target: { files: [first] } });
  expect(createUrl).toHaveBeenCalledWith(first);
  expect(document.querySelector('img[src="blob:first"]')).not.toBeNull();
  fireEvent.change(input, { target: { files: [second] } });
  expect(revokeUrl).toHaveBeenCalledWith("blob:first");
  expect(document.querySelector('img[src="blob:second"]')).not.toBeNull();
  fireEvent.click(saveButton("create"));
  expect((submittedFields(0).avatar as File).name).toBe("b.png");
});

it("ignores a cleared file selection", () => {
  renderPanel();
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement))
    throw new Error("Missing file input");
  fireEvent.change(input, { target: { files: [] } });
  fireEvent.click(saveButton("create"));
  expect("avatar" in submittedFields(0)).toBe(false);
});

it("sends an empty role when no role is offered", () => {
  renderPanel({ roles: [] });
  fireEvent.click(saveButton("create"));
  expect(JSON.parse(String(submittedFields(0).agent))).toMatchObject({
    roleId: "",
  });
});

it("saves the memory and the learning switch edited in the memory tab", async () => {
  renderPanel();
  openTab("memory");
  fireEvent.change(screen.getByRole("textbox", { name: "MEMORY.md" }), {
    target: { value: "Remember the milk" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "DREAM.md" }), {
    target: { value: "Dream of electric sheep" },
  });
  fireEvent.keyDown(
    screen.getByRole("combobox", {
      name: i18n.t("agentEmployees.memory.autoLearn"),
    }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("option", {
      name: i18n.t("agentEmployees.memory.off"),
    }),
  );
  fireEvent.click(saveButton("create"));
  expect(JSON.parse(String(submittedFields(0).agent))).toMatchObject({
    memory: "Remember the milk",
    dream: "Dream of electric sheep",
    isLearningEnabled: false,
  });
});

it("keeps the typed draft when the agent is read again with the same version", async () => {
  const fetchMock = stubFetch(syntheticDetail(), syntheticDetail());
  const { rerender } = renderPanel({ agentId: "agent-1" });
  await screen.findByDisplayValue("Ada Agent");
  fireEvent.change(field("name"), { target: { value: "Typed" } });
  router.actionData = { ok: true, intent: "restore-agent-memory" };
  rerender();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(saveButton("save").disabled).toBe(false));
  expect(field("name").value).toBe("Typed");
});
