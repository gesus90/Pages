import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { expect, it, vi } from "vitest";

import { PlanCanvas } from "@/app/components/agents/plans/plan-canvas";
import { usePlanGraph } from "@/app/components/agents/plans/use-plan-graph";

import {
  GROUP_SOURCES,
  agentNode,
  flowEdge,
  i18n,
  planOf,
  renderTranslated,
} from "./plan-group-fixture";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentWorkspaceChoice } from "@/definition/AgentWorkspace";

const WORKSPACE: AgentWorkspaceChoice = {
  id: "workspace",
  name: "Workspace",
  path: "/synthetic",
  projectId: "project",
  projectName: "Project",
  github: null,
  isUsable: true,
  reason: null,
};

interface CanvasOptions {
  readonly graph?: Partial<PlanGraphActions>;
  readonly planId?: string;
  readonly workspaces?: readonly AgentWorkspaceChoice[];
}

function Canvas(props: CanvasOptions): React.ReactElement {
  const [draft, setDraft] = useState(() =>
    planOf(
      [
        { id: "start", type: "start", x: 0, y: 0 },
        agentNode("agent", "codex", { x: 320 }),
        { id: "end", type: "end", x: 720, y: 0 },
      ],
      [flowEdge("start", "agent"), flowEdge("agent", "end")],
    ),
  );
  const actions = usePlanGraph(draft, setDraft, GROUP_SOURCES);
  return (
    <PlanCanvas
      draft={draft}
      sources={GROUP_SOURCES}
      graph={{ ...actions, ...props.graph }}
      canEdit
      run={null}
      planId={props.planId}
      workspaces={props.workspaces}
      panel={<p>Page panel</p>}
      status={<p>Page status</p>}
    />
  );
}

function renderCanvas(options: CanvasOptions = {}): void {
  renderTranslated(<Canvas {...options} />);
}

function statusWith(text: string): HTMLElement {
  const status = screen
    .getByText(text, { exact: false })
    .closest("[role=status]");
  if (!(status instanceof HTMLElement))
    throw new Error(`Missing status ${text}`);
  return status;
}

function canvas(): HTMLElement {
  return screen.getByRole("region", { name: i18n.t("plans.canvas") });
}

function overlay(): HTMLElement {
  const stack = document.querySelector("[data-plan-upper-stack]");
  const parent = stack?.parentElement;
  if (!parent) throw new Error("Missing overlay");
  return parent;
}

/** The part of a drag's data transfer that the palette and the canvas use. */
function dataTransfer(): Pick<
  DataTransfer,
  "dropEffect" | "effectAllowed" | "setData" | "getData" | "types"
> {
  return {
    dropEffect: "none",
    effectAllowed: "all",
    setData: vi.fn(),
    getData: vi.fn(() => ""),
    types: [],
  };
}

it("stacks the page panel, the page status and the palette beside the canvas", () => {
  renderCanvas();
  expect(canvas()).toBeTruthy();
  expect(within(overlay()).getByText("Page panel")).toBeTruthy();
  expect(within(overlay()).getByText("Page status")).toBeTruthy();
  expect(
    screen.getByRole("complementary", { name: i18n.t("plans.palette.label") }),
  ).toBeTruthy();
  expect(screen.queryByText(i18n.t("plans.connectHint"))).toBeNull();
  expect(screen.queryByText(i18n.t("plans.groups.moved"))).toBeNull();
});

it("makes room for the run details while they are open", () => {
  renderCanvas();
  expect(overlay().className).toContain("@5xl:bottom-4");
  expect(overlay().className).not.toContain("min(26rem,36%)");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.progress.open") }),
  );
  expect(overlay().className).toContain("min(26rem,36%)");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.progress.close") }),
  );
  expect(overlay().className).not.toContain("min(26rem,36%)");
});

it("drops a node dragged from the palette onto the canvas", () => {
  const add = vi.fn();
  renderCanvas({ graph: { add } });
  const start = document.querySelector('[data-plan-palette-kind="start"]');
  if (!start) throw new Error("Missing palette entry");
  const transfer = dataTransfer();
  fireEvent.dragStart(start, { dataTransfer: transfer });
  // The canvas accepts the drag, which keeps the copy cursor.
  expect(fireEvent.dragOver(canvas(), { dataTransfer: transfer })).toBe(false);
  fireEvent.drop(canvas(), { dataTransfer: transfer, clientX: 0, clientY: 0 });
  expect(add).toHaveBeenCalledWith("start", "", expect.any(Object));
  // Without a drag in progress the canvas ignores dragged content.
  expect(fireEvent.dragOver(canvas(), { dataTransfer: transfer })).toBe(true);
});

it("ends an open connection with Escape and from its hint", () => {
  const begin = vi.fn();
  renderCanvas({
    graph: { begin, connection: { kind: "flow", nodeId: "start" } },
  });
  const hint = statusWith(i18n.t("plans.connectHint"));
  expect(hint.className).toContain("border-border");
  fireEvent.keyDown(canvas(), { key: "Escape" });
  expect(begin).toHaveBeenLastCalledWith(null);
  begin.mockClear();
  fireEvent.click(
    within(hint).getByRole("button", {
      name: i18n.t("settings.agents.cancel"),
    }),
  );
  expect(begin).toHaveBeenCalledWith(null);
});

it("tells why a chosen input refused the open connection", () => {
  renderCanvas({
    graph: {
      connection: { kind: "flow", nodeId: "start" },
      connectionIssue: { nodeId: "end", port: "flow-in", reason: "cycle" },
    },
  });
  const hint = statusWith(i18n.t("plans.validation.cycle"));
  expect(hint.className).toContain("text-destructive");
});

it("shows the group notice above the canvas until it is closed", () => {
  const clearNotice = vi.fn();
  renderCanvas({
    graph: {
      clearNotice,
      notice: {
        kind: "moved",
        frame: "group",
        removedEdges: 0,
        removedBindings: 0,
      },
    },
  });
  expect(statusWith(i18n.t("plans.groups.moved")).textContent).toBe(
    i18n.t("plans.groups.moved"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.groups.closeNotice") }),
  );
  expect(clearNotice).toHaveBeenCalledOnce();
});

async function saveAgentTemplate(): Promise<FormData> {
  // jsdom has no CSS namespace; the closed dialog escapes the node ID to return the focus.
  vi.stubGlobal("CSS", { escape: (value: string): string => value });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ error: "general" }, { status: 500 }));
  const menu = await within(canvas()).findByRole("button", {
    name: i18n.t("settings.agents.actionsFor", { name: "Codex One" }),
  });
  fireEvent.keyDown(menu, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("plans.templates.saveAction"),
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: new RegExp(i18n.t("plans.templates.saveTitle")),
  });
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("plans.templates.save"),
    }),
  );
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  const body = fetch.mock.calls.at(-1)?.[1]?.body;
  if (!(body instanceof FormData)) throw new Error("Missing template form");
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("settings.agents.cancel"),
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // A cancelled save returns the focus to the node it was asked for.
  await waitFor(() =>
    expect(document.activeElement?.getAttribute("data-plan-handle")).toBe(
      "agent",
    ),
  );
  return body;
}

it("saves an agent of an unsaved plan as a template without a plan", async () => {
  renderCanvas();
  const body = await saveAgentTemplate();
  expect(body.get("planId")).toBe("");
  expect(body.get("workspaceId")).toBe("workspace");
}, 15_000);

it("saves an agent of a saved plan as a template of that plan", async () => {
  renderCanvas({ planId: "plan-1", workspaces: [WORKSPACE] });
  const body = await saveAgentTemplate();
  expect(body.get("planId")).toBe("plan-1");
}, 15_000);
