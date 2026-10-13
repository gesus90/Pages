// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { isValidElement, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

const boundaries = vi.hoisted(() => ({
  dialog: vi.fn(),
  targets: vi.fn(),
  fetcher: vi.fn(),
  loader: vi.fn(),
  blocker: { state: "blocked", reset: vi.fn(), proceed: vi.fn() },
}));
vi.mock("@/app/components/ui/button", () => ({
  Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type={props.type}
      aria-label={props["aria-label"]}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));
vi.mock("@/app/components/ui/select", () => ({
  Select: (props: {
    value: string;
    onValueChange: (selected: string) => void;
    ariaLabel?: string;
    options: readonly {
      value: string;
      label: string;
      disabled?: boolean;
      description?: string;
    }[];
  }) => (
    <select
      value={props.value}
      aria-label={props.ariaLabel}
      onChange={(event) => props.onValueChange(event.target.value)}
    >
      <option value="invalid-control-value">Invalid external selection</option>
      {props.options.map((entry) => (
        <option
          key={entry.value}
          value={entry.value}
          disabled={entry.disabled}
          title={entry.description}
        >
          {entry.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/app/components/ui/dialog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/components/ui/dialog")>();
  const content = (props: { children: React.ReactNode }) => (
    <div>{props.children}</div>
  );
  return {
    ...actual,
    DialogContent: content,
    DialogTitle: content,
    DialogDescription: content,
    Dialog: (props: {
      children: React.ReactNode;
      onOpenChange: (open: boolean) => void;
    }) => {
      boundaries.dialog(props.onOpenChange);
      return <div>{props.children}</div>;
    },
  };
});
vi.mock("@/app/components/settings/agents/agent-profile-targets", () => ({
  AgentProfileTargets: (props: {
    onChange: (targets: readonly unknown[]) => void;
  }) => {
    boundaries.targets(props.onChange);
    return null;
  },
}));
vi.mock("@/app/components/editor/block-editor", () => ({
  BlockEditor: (props: {
    markdown: string;
    label: string;
    onChange: (markdown: string) => void;
  }) => (
    <textarea
      aria-label={props.label}
      value={props.markdown}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useBlocker: () => boundaries.blocker,
  useFetcher: boundaries.fetcher,
  useLoaderData: boundaries.loader,
  useNavigation: () => ({ state: "idle" }),
}));

import { PlanGlobals } from "@/app/components/agents/plans/plan-globals";
import { PlanPorts } from "@/app/components/agents/plans/plan-ports";
import { PlanLeaveGuard } from "@/app/components/agents/plans/plan-leave-guard";
import { PlanConnections } from "@/app/components/agents/plans/plan-connections";
import { PlanEdges } from "@/app/components/agents/plans/plan-edges";
import { PlanRunView } from "@/app/components/agents/plans/plan-run-view";
import { WorkspaceForm } from "@/app/components/agents/workspaces/workspace-form";
import AgentWorkspacesRoute from "@/app/routes/agent-workspaces";
import { AgentProfileDelete } from "@/app/components/settings/agents/agent-profile-delete";
import { AgentProfileForm } from "@/app/components/settings/agents/agent-profile-form";
import { MemoryRouter } from "react-router";
import { AgentConfigurationFields } from "@/app/components/settings/agents/agent-configuration-fields";
import { AgentParameterRow } from "@/app/components/settings/agents/agent-parameter-row";
import { AgentParameterDefault } from "@/app/components/settings/agents/agent-parameter-default";
import { AgentNavigation } from "@/app/components/settings/agents/agent-navigation";
import { AgentTemplateEditor } from "@/app/components/settings/agents/agent-template-editor";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import { planUiPage, planUiStep } from "../helpers/agent-plan-ui";

import type { PlanGraphActions } from "@/app/components/agents/plans/use-plan-graph";
import type { AgentParameter } from "@/definition/AgentParameters";

function wrapper({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return <I18nextProvider i18n={createI18n("en")}>{children}</I18nextProvider>;
}
function graph(): PlanGraphActions {
  return {
    selectedId: null,
    select: vi.fn(),
    connection: null,
    begin: vi.fn(),
    connect: vi.fn(),
    bindSource: vi.fn(),
    add: vi.fn().mockReturnValue("created"),
    move: vi.fn(),
    remove: vi.fn(),
    replaceStep: vi.fn(),
  };
}

describe("A10 component boundary guards and stale reference regression", () => {
  it("opens the agent editor without optional project choices", () => {
    const Form = (
      props: React.FormHTMLAttributes<HTMLFormElement>,
    ): React.ReactElement => <form {...props} />;
    boundaries.fetcher.mockReturnValue({
      state: "idle",
      data: undefined,
      Form,
    });
    render(
      <AgentProfileForm
        profile={null}
        connections={[]}
        catalogs={{}}
        directory={{ persons: [], groups: [], departments: [] }}
        onSaved={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(screen.getByRole("option", { name: "Global" })).toBeInTheDocument();
  });
  it("keeps the central agent list active and explains unusable default workspaces", () => {
    render(
      <MemoryRouter initialEntries={["/settings/agents"]}>
        <AgentNavigation />
      </MemoryRouter>,
      { wrapper },
    );
    expect(screen.getByRole("link", { name: "Agents list" })).toHaveClass(
      "bg-primary-subtle",
    );
    const workspace = {
      ...planUiPage().workspaces[0],
      isUsable: false,
      reason: "workspace_access_denied" as const,
    };
    render(
      <AgentParameterDefault
        parameter={{
          name: "root",
          type: "workspace",
          description: "",
          isRequired: true,
          defaultValue: null,
        }}
        disabled={false}
        onChange={vi.fn()}
        workspaceChoices={[workspace]}
      />,
      { wrapper },
    );
    const unavailable = screen.getByRole("option", {
      name: "Development · Project",
    });
    expect(unavailable).toBeDisabled();
    expect(unavailable).toHaveAttribute(
      "title",
      expect.stringMatching(/access/i),
    );
  });
  it("serializes only name, path and project of a workspace and handles controlled dialog open notifications", () => {
    const Form = (
      props: React.FormHTMLAttributes<HTMLFormElement>,
    ): React.ReactElement => <form {...props} />;
    boundaries.fetcher.mockReturnValue({
      state: "idle",
      data: undefined,
      Form,
    });
    const form = render(
      <WorkspaceForm workspace={null} projects={[]} onSaved={vi.fn()} />,
      { wrapper },
    );
    const serialized = form.container.querySelector('input[name="workspace"]');
    expect(serialized).toHaveValue(
      JSON.stringify({ name: "", path: "", projectId: "" }),
    );
    form.unmount();
    const page = {
      canManage: false,
      isAdministrator: false,
      isConfigured: true,
      workspaces: [],
      projects: [],
    };
    boundaries.loader.mockReturnValue(page);
    boundaries.dialog.mockClear();
    render(
      <MemoryRouter>
        <AgentWorkspacesRoute />
      </MemoryRouter>,
      { wrapper },
    );
    const open: unknown = boundaries.dialog.mock.calls[0][0];
    if (typeof open !== "function")
      throw new Error("Missing workspace dialog callback");
    act(() => open(true));
    act(() => open(false));
    expect(
      screen.getByRole("heading", { name: "Workspaces", level: 1 }),
    ).toBeVisible();
  });

  it("closes agent deletion only after a completed deletion response", () => {
    const onClose = vi.fn();
    const Form = (
      props: React.FormHTMLAttributes<HTMLFormElement>,
    ): React.ReactElement => <form {...props} />;
    const fetcher = {
      state: "loading",
      data: { ok: true, intent: "delete-profile", usages: [] },
      submit: vi.fn(),
      Form,
    };
    boundaries.fetcher.mockReturnValue(fetcher);
    const props = {
      profile: {
        id: "agent",
        name: "Worker",
        connectionId: "access",
        model: "model-a",
        reasoningEffort: null,
        isActive: true,
        purposes: ["agent" as const],
        targets: [],
      },
      directory: { persons: [], groups: [], departments: [] },
      onClose,
    };
    const view = render(<AgentProfileDelete {...props} />, { wrapper });
    expect(onClose).not.toHaveBeenCalled();
    fetcher.state = "idle";
    view.rerender(<AgentProfileDelete {...props} />);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("ignores invalid and duplicate global names even if a control emits a disabled click", () => {
    const changed = vi.fn();
    const draft = {
      ...emptyAgentPlan(),
      workspaceId: "workspace",
      globals: { branch: "main" },
    };
    render(
      <PlanGlobals
        draft={draft}
        graph={graph()}
        disabled={false}
        onChange={changed}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    fireEvent.change(screen.getByLabelText("Parameter name (e.g. branch)"), {
      target: { value: "branch" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add parameter" }));
    expect(changed).not.toHaveBeenCalled();
  });

  it("ignores unsupported scope and type callbacks and resets organizational targets when selecting personal scope", () => {
    const changed = vi.fn();
    const targets = vi.fn();
    render(
      <AgentConfigurationFields
        configuration={emptyAgentConfiguration("system")}
        disabled={false}
        projects={[]}
        onChange={changed}
        onTargets={targets}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "invalid-control-value" },
    });
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Scope"), {
      target: { value: "person" },
    });
    expect(changed).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "person", accessMode: "personal" }),
    );
    expect(targets).toHaveBeenCalledWith([]);
    render(
      <AgentParameterRow
        parameter={{
          name: "goal",
          type: "text",
          description: "",
          isRequired: true,
          defaultValue: null,
        }}
        disabled={false}
        onChange={changed}
      />,
      { wrapper },
    );
    changed.mockClear();
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "invalid-control-value" },
    });
    expect(changed).not.toHaveBeenCalled();
  });

  it("ignores all read-only port callbacks and refuses nontext drops or drag-over acceptance", () => {
    const actions = graph();
    const parameters: readonly AgentParameter[] = [
      {
        name: "input",
        type: "text",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
      {
        name: "root",
        type: "workspace",
        description: "",
        isRequired: true,
        defaultValue: null,
      },
    ];
    const hook = renderHook(
      () =>
        PlanPorts({
          node: planUiStep(),
          label: "Worker",
          parameters,
          graph: actions,
          canEdit: false,
        }),
      { wrapper },
    );
    if (
      !isValidElement<{ children: readonly React.ReactElement[] }>(
        hook.result.current,
      )
    )
      throw new Error("Missing port fragment");
    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      dataTransfer: { getData: () => "task:task" },
    };
    for (const port of hook.result.current.props.children) {
      if (!isValidElement<Record<string, unknown>>(port))
        throw new Error("Missing port");
      for (const name of ["onClick", "onDrop", "onDragOver"]) {
        const callback = port.props[name];
        if (typeof callback !== "function")
          throw new Error("Missing port callback");
        act(() => callback(event));
      }
    }
    expect(actions.bindSource).not.toHaveBeenCalled();
    expect(actions.add).not.toHaveBeenCalled();
    expect(actions.connect).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it("renders dangling flow and data edges safely, and keeps a denied run's reason visible", () => {
    const draft = {
      ...emptyAgentPlan(),
      nodes: [planUiStep()],
      edges: [{ from: "gone", to: "A" }],
    };
    render(
      <PlanConnections
        draft={draft}
        sources={planUiPage().sources}
        disabled={true}
        onChange={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.getByText("gone → Worker")).toBeVisible();
    const source = {
      id: "task",
      type: "task" as const,
      taskId: "task",
      x: 0,
      y: 0,
    };
    const plan = {
      ...draft,
      nodes: [
        source,
        {
          ...planUiStep(),
          agentId: "missing-agent",
          bindings: { input: { kind: "source" as const, nodeId: "task" } },
        },
      ],
    };
    const rendered = render(
      <PlanEdges plan={plan} sources={planUiPage().sources} />,
    );
    expect(
      rendered.container.querySelectorAll('path[stroke-dasharray="6 4"]'),
    ).toHaveLength(1);
    render(
      <PlanRunView
        state={{
          runs: [],
          selectedId: "revoked",
          run: null,
          error: "plan_access_denied",
          select: vi.fn(),
        }}
        onStop={vi.fn()}
        isPending={false}
      />,
      { wrapper },
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/access/);
  });

  it("keeps the navigation blocker active on an open notification and resets only after dismissal", () => {
    boundaries.dialog.mockClear();
    boundaries.blocker.reset.mockClear();
    render(<PlanLeaveGuard isDirty={false} />, { wrapper });
    const callback: unknown = boundaries.dialog.mock.calls[0][0];
    if (typeof callback !== "function")
      throw new Error("Missing dialog callback");
    act(() => callback(true));
    expect(boundaries.blocker.reset).not.toHaveBeenCalled();
    act(() => callback(false));
    expect(boundaries.blocker.reset).toHaveBeenCalledOnce();
  });

  it("preserves markdown updates through the template editor boundary", () => {
    function Editor(): React.ReactElement {
      const [configuration, setConfiguration] = useState(
        emptyAgentConfiguration(),
      );
      return (
        <AgentTemplateEditor
          configuration={configuration}
          disabled={false}
          onChange={setConfiguration}
        />
      );
    }
    render(<Editor />, { wrapper });
    fireEvent.change(screen.getByLabelText("Markdown base configuration"), {
      target: { value: "{{goal}}" },
    });
    expect(
      screen.getByRole("button", { name: "Confirm parameter" }),
    ).toBeVisible();
  });
});
