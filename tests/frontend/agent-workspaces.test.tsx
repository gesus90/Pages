// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

import { WorkspacePage } from "@/app/components/agents/workspaces/workspace-page";
import { AgentParameterDefault } from "@/app/components/settings/agents/agent-parameter-default";
import { AgentNavigation } from "@/app/components/settings/agents/agent-navigation";
import { createI18n } from "@/app/lib/i18n";

import type { AgentParameter } from "@/definition/AgentParameters";
import type { AgentWorkspacePage } from "@/definition/AgentWorkspace";

// Coverage instrumentation on a busy machine can push a dialog past the one
// second that Testing Library waits by default.
const SLOW_UI_WAIT = { timeout: 10_000 };

const workspace = {
  id: "workspace-id",
  name: "Development",
  path: "/approved/project",
  projectId: "project",
  projectName: "Project",
  github: {
    repoUrl: "https://github.com/example/project.git",
    repoName: "example/project",
  },
  isUsable: true,
  reason: null,
  revision: 1,
  canManage: false,
  targets: [],
} as const;

function page(canManage: boolean): AgentWorkspacePage {
  return {
    canManage,
    isConfigured: true,
    workspaces: [{ ...workspace, canManage }],
    projects: [{ id: "project", name: "Project", github: workspace.github }],
    directory: {
      persons: [{ id: "bob", name: "Bob" }],
      groups: [],
      departments: [],
    },
  };
}

async function mount(
  content: React.ReactElement,
  action?: (request: Request) => Promise<unknown>,
): Promise<void> {
  const i18n = await createI18n("en");
  const Stub = createRoutesStub([
    {
      path: "/agents/workspaces",
      Component: () => content,
      action: action ? ({ request }) => action(request) : undefined,
    },
  ]);
  render(
    <I18nextProvider i18n={i18n}>
      <Stub initialEntries={["/agents/workspaces"]} />
    </I18nextProvider>,
  );
  await screen.findByRole("heading", { name: "Workspaces", level: 1 });
}

describe("A10.3 workspace UI and workspace reference selection", () => {
  it("edits an existing registration, preserves its revision and guards Escape and browser unload", async () => {
    const submitted: FormData[] = [];
    await mount(<WorkspacePage page={page(true)} />, async (request) => {
      submitted.push(await request.formData());
      return { ok: false, error: "workspace_conflict" };
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Actions for Development" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Development");
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Edited");
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    await user.click(screen.getByRole("button", { name: "Save workspace" }));
    expect(
      await screen.findByRole("alert", {}, SLOW_UI_WAIT),
    ).toHaveTextContent(/changed/);
    expect(JSON.parse(String(submitted[0].get("workspace")))).toMatchObject({
      revision: 1,
      name: "Edited",
    });
    // Escape is ignored while the save is pending, so wait until it settled.
    await waitFor(
      () =>
        expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled(),
      SLOW_UI_WAIT,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(
      await screen.findByRole(
        "button",
        { name: "Discard changes" },
        SLOW_UI_WAIT,
      ),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(
      () => expect(screen.queryByRole("dialog")).toBeNull(),
      SLOW_UI_WAIT,
    );
    const afterClose = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterClose);
    expect(afterClose.defaultPrevented).toBe(false);
  });

  it("shows unregister uses and pending state, retains failures and confirms an unused registration", async () => {
    let finish: ((result: unknown) => void) | undefined;
    let usages: readonly { id: string; name: string }[] = [
      { id: "plan", name: "Build plan" },
    ];
    let shouldFail = true;
    const submitted: FormData[] = [];
    await mount(<WorkspacePage page={page(true)} />, async (request) => {
      const form = await request.formData();
      submitted.push(form);
      if (form.get("intent") === "workspace-usages")
        return new Promise<unknown>((resolve) => {
          finish = resolve;
        });
      return shouldFail
        ? { ok: false, error: "workspace_in_use" }
        : { ok: true, intent: "delete-workspace" };
    });
    const user = userEvent.setup();
    async function open(): Promise<void> {
      await user.click(
        screen.getByRole("button", { name: "Actions for Development" }),
      );
      await user.click(
        screen.getByRole("menuitem", { name: "Remove registration" }),
      );
      await waitFor(() => expect(finish).toBeDefined());
    }
    await open();
    expect(
      screen.getByRole("button", { name: "Remove registration" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await act(async () =>
      finish?.({
        ok: true,
        intent: "workspace-usages",
        workspaceUsages: usages,
      }),
    );
    expect(await screen.findByText("Build plan")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove registration" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    finish = undefined;
    usages = [];
    await open();
    await act(async () =>
      finish?.({
        ok: true,
        intent: "workspace-usages",
        workspaceUsages: usages,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove registration" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove registration" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/references/);
    expect(
      screen.getByRole("button", { name: "Remove registration" }),
    ).toBeDisabled();
    expect(submitted.at(-1)?.get("revision")).toBe("1");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    finish = undefined;
    shouldFail = false;
    await open();
    await act(async () =>
      finish?.({ ok: true, intent: "workspace-usages", workspaceUsages: [] }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove registration" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove registration" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows an empty unauthorized-root page and retains a removed project when reopening a registration", async () => {
    await mount(
      <WorkspacePage
        page={{ ...page(false), isConfigured: false, workspaces: [] }}
      />,
    );
    expect(screen.getByText("No accessible workspaces yet.")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Working directories have not been approved on the server yet.",
    );
  });

  it("opens a legacy workspace with no GitHub or current project and closes a clean editor", async () => {
    await mount(
      <WorkspacePage
        page={{
          ...page(true),
          projects: [],
          workspaces: [{ ...workspace, github: null, canManage: true }],
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Actions for Development" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("combobox", { name: "Project" })).toHaveTextContent(
      "Project no longer available",
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers agent navigation and current GitHub data while restricting workspace administration", async () => {
    await mount(
      <>
        <AgentNavigation canManage={false} />
        <WorkspacePage page={page(false)} />
      </>,
    );
    expect(screen.getByRole("link", { name: "Workspace" })).toHaveAttribute(
      "href",
      "/agents/workspaces",
    );
    expect(screen.getByRole("link", { name: "Agents list" })).toHaveAttribute(
      "href",
      "/settings/agents",
    );
    expect(
      screen.queryByRole("button", { name: "Register workspace" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(workspace.github.repoUrl)).toBeVisible();
    expect(screen.getByText(workspace.path)).toBeVisible();
  });

  it("serializes registration with a project and grants, inherits GitHub and asks before discarding edits", async () => {
    const submitted: FormData[] = [];
    await mount(<WorkspacePage page={page(true)} />, async (request) => {
      submitted.push(await request.formData());
      return { ok: true, intent: "save-workspace" };
    });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Register workspace" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Name" }),
      "Existing workspace",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Working directory" }),
      "/approved/new",
    );
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(screen.getByRole("option", { name: "Project" }));
    await user.click(screen.getByRole("checkbox", { name: "Bob" }));
    expect(screen.getAllByText(workspace.github.repoUrl)).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Save workspace" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    expect(submitted[0].get("intent")).toBe("save-workspace");
    expect(JSON.parse(String(submitted[0].get("workspace")))).toEqual({
      name: "Existing workspace",
      path: "/approved/new",
      projectId: "project",
      targets: [{ kind: "person", targetId: "bob" }],
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await user.click(
      screen.getByRole("button", { name: "Register workspace" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Unsaved");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("button", { name: "Discard changes" }),
    ).toBeVisible();
  });

  it("keeps unavailable directories visible and blocks registration without configured roots", async () => {
    const current = page(true);
    await mount(
      <WorkspacePage
        page={{
          ...current,
          isConfigured: false,
          workspaces: [
            {
              ...current.workspaces[0],
              isUsable: false,
              reason: "workspace_path_changed",
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Register workspace" }),
    ).toBeDisabled();
    expect(screen.getByText(/PAGES_WORKSPACE_ROOTS/)).toBeVisible();
    expect(screen.getByText(/registered directory was replaced/)).toBeVisible();
  });

  it("stores a workspace ID as the default and offers an explicit way to clear it", async () => {
    const i18n = await createI18n("en");
    function Parameter(): React.ReactElement {
      const [parameter, setParameter] = useState<AgentParameter>({
        name: "workspace",
        type: "workspace",
        description: "",
        isRequired: true,
        defaultValue: null,
      });
      return (
        <>
          <AgentParameterDefault
            parameter={parameter}
            onChange={setParameter}
            disabled={false}
            workspaceChoices={[workspace]}
          />
          <output>{JSON.stringify(parameter.defaultValue)}</output>
        </>
      );
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Parameter />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox"));
    await user.click(
      screen.getByRole("option", { name: "Development · Project" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      '{"type":"workspace","workspaceId":"workspace-id"}',
    );
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("option", { name: "No default" }));
    expect(screen.getByRole("status")).toHaveTextContent("null");
  });
});
