// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub, Link } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PlanFields } from "@/app/components/agents/plans/plan-fields";
import { WorkspacePage } from "@/app/components/agents/workspaces/workspace-page";
import { AgentNavigation } from "@/app/components/settings/agents/agent-navigation";
import { createI18n } from "@/app/lib/i18n";
import { ErrorBoundary } from "@/app/routes/agent-workspaces";
import { emptyAgentPlan } from "@/definition/AgentPlan";

import type { AgentWorkspacePage } from "@/definition/AgentWorkspace";
import type { Language } from "@/language/Language";

// Coverage-free runs are fast, but the dialogs of Radix need a generous budget on a busy machine.
const SLOW_UI_WAIT = { timeout: 10_000 };

const github = {
  repoUrl: "https://github.com/example/project.git",
  repoName: "example/project",
};

function workspace(
  overrides: Partial<AgentWorkspacePage["workspaces"][number]> = {},
): AgentWorkspacePage["workspaces"][number] {
  return {
    id: "workspace-id",
    name: "Development",
    path: "/approved/project",
    projectId: "project",
    projectName: "Project",
    github,
    isUsable: true,
    reason: null,
    revision: 1,
    canManage: true,
    ...overrides,
  };
}

function page(overrides: Partial<AgentWorkspacePage> = {}): AgentWorkspacePage {
  return {
    canManage: true,
    isAdministrator: false,
    isConfigured: true,
    workspaces: [workspace()],
    projects: [{ id: "project", name: "Project", github }],
    ...overrides,
  };
}

async function mount(
  content: React.ReactElement,
  options: {
    readonly language?: Language;
    readonly action?: (request: Request) => Promise<unknown>;
  } = {},
): Promise<void> {
  const i18n = await createI18n(options.language ?? "en");
  const { action } = options;
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
}

describe("PAGE-25 overview of the workspaces", () => {
  it("lists name, project and local path with the GitHub link and the availability", async () => {
    await mount(<WorkspacePage page={page()} />);
    expect(
      await screen.findByRole("heading", { name: "Workspaces", level: 1 }),
    ).toBeVisible();
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual([
      "Name",
      "Project",
      "Local path",
      "GitHub from project",
      "Availability",
      "Actions",
    ]);
    const row = screen.getByRole("row", { name: /Development/u });
    expect(within(row).getByText("Project")).toBeVisible();
    expect(within(row).getByText("/approved/project")).toBeVisible();
    expect(within(row).getByText(github.repoUrl)).toBeVisible();
    expect(within(row).getByText("Available")).toBeVisible();
  });

  it("names the section Arbeitsverzeichnis in German, both in the menu and as page title", async () => {
    await mount(
      <>
        <AgentNavigation />
        <WorkspacePage page={page()} />
      </>,
      { language: "de" },
    );
    expect(
      await screen.findByRole("link", { name: "Arbeitsverzeichnis" }),
    ).toHaveAttribute("href", "/agents/workspaces");
    expect(
      screen.getByRole("heading", { name: "Arbeitsverzeichnis", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("columnheader", { name: "Lokaler Pfad" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Arbeitsbereich registrieren" }),
    ).toBeVisible();
  });

  it("explains an empty list differently for people who can and cannot register", async () => {
    await mount(<WorkspacePage page={page({ workspaces: [] })} />);
    expect(
      await screen.findByText(/No workspace registered yet/u),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Register workspace" }),
    ).toBeVisible();
  });

  it("shows no registration control and a plain empty message to people who only use workspaces", async () => {
    await mount(
      <WorkspacePage
        page={page({ canManage: false, workspaces: [], projects: [] })}
      />,
    );
    expect(
      await screen.findByText(
        "No workspaces are registered for your projects yet.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Register workspace" }),
    ).not.toBeInTheDocument();
  });

  it("offers the agent administration link to administrators only", async () => {
    await mount(<WorkspacePage page={page({ isAdministrator: true })} />);
    expect(
      await screen.findByRole("link", { name: "Agent management" }),
    ).toHaveAttribute("href", "/settings/agents");
  });

  it("hides the agent administration link from project managers", async () => {
    await mount(<WorkspacePage page={page({ isAdministrator: false })} />);
    await screen.findByRole("heading", { name: "Workspaces", level: 1 });
    expect(
      screen.queryByRole("link", { name: "Agent management" }),
    ).not.toBeInTheDocument();
  });

  it("shows a loading state while the list is being reloaded", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const i18n = await createI18n("en");
    const Stub = createRoutesStub([
      {
        path: "/agents/workspaces",
        loader: async ({ request }) => {
          if (new URL(request.url).searchParams.has("reload")) await gate;
          return null;
        },
        Component: () => (
          <>
            <Link to="?reload=1">Reload</Link>
            <WorkspacePage page={page()} />
          </>
        ),
      },
    ]);
    render(
      <I18nextProvider i18n={i18n}>
        <Stub initialEntries={["/agents/workspaces"]} />
      </I18nextProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Reload" }));
    expect(
      await screen.findByRole("status", { name: "Loading workspaces …" }),
    ).toBeVisible();
    release();
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Loading workspaces …" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText("/approved/project")).toBeVisible();
  });
});

describe("PAGE-25 failure state of the overview", () => {
  async function mountFailing(status: number): Promise<{
    readonly loads: () => number;
  }> {
    let loads = 0;
    const i18n = await createI18n("en");
    const Stub = createRoutesStub([
      {
        path: "/agents/workspaces",
        loader: () => {
          loads += 1;
          if (loads === 1) throw new Response("failure", { status });
          return null;
        },
        Component: () => <WorkspacePage page={page()} />,
        ErrorBoundary,
      },
    ]);
    render(
      <I18nextProvider i18n={i18n}>
        <Stub initialEntries={["/agents/workspaces"]} />
      </I18nextProvider>,
    );
    return { loads: () => loads };
  }

  it("keeps the page chrome, says that loading failed and retries on request", async () => {
    const counter = await mountFailing(500);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workspaces could not be loaded.",
    );
    expect(
      screen.getByRole("heading", { name: "Workspaces", level: 1 }),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("/approved/project")).toBeVisible();
    expect(counter.loads()).toBe(2);
  });

  it("explains a refused access without offering a retry", async () => {
    await mountFailing(403);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You don't have permission to view this page.",
    );
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
  });
});

describe("PAGE-25 registration form", () => {
  const projects = [
    { id: "linked", name: "Linked", github },
    { id: "unlinked", name: "Unlinked", github: null },
  ];

  it("lets only projects with a GitHub link be chosen and saves name, path and project", async () => {
    const submitted: FormData[] = [];
    await mount(<WorkspacePage page={page({ workspaces: [], projects })} />, {
      action: async (request) => {
        submitted.push(await request.formData());
        return { ok: true, intent: "save-workspace" };
      },
    });
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Register workspace" }),
    );
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Local");
    await user.type(
      screen.getByRole("textbox", { name: "Local path" }),
      "/approved/local",
    );
    const save = screen.getByRole("button", { name: "Save workspace" });
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    const unsupported = screen.getByRole("option", {
      name: "Unlinked (no GitHub link)",
    });
    expect(unsupported).toHaveAttribute("aria-disabled", "true");
    await user.click(unsupported);
    expect(save).toBeDisabled();
    await user.click(screen.getByRole("option", { name: "Linked" }));
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() => expect(submitted).toHaveLength(1), SLOW_UI_WAIT);
    expect(JSON.parse(String(submitted[0].get("workspace")))).toEqual({
      name: "Local",
      path: "/approved/local",
      projectId: "linked",
    });
  });

  it("blocks saving a registration whose project lost its GitHub link until another project is chosen", async () => {
    await mount(
      <WorkspacePage
        page={page({
          projects,
          workspaces: [
            workspace({
              projectId: "unlinked",
              projectName: "Unlinked",
              github: null,
              isUsable: false,
              reason: "workspace_project_unsupported",
            }),
          ],
        })}
      />,
    );
    expect(
      await screen.findByText(
        "The project needs a link to a GitHub repository.",
      ),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "Actions for Development" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This project has no GitHub link.",
    );
    const name = screen.getByRole("textbox", { name: "Name" });
    await user.type(name, " renamed");
    expect(
      screen.getByRole("button", { name: "Save workspace" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("combobox", { name: "Project" }));
    await user.click(screen.getByRole("option", { name: "Linked" }));
    expect(
      screen.getByRole("button", { name: "Save workspace" }),
    ).toBeEnabled();
  });

  it("states who sees and who manages a workspace", async () => {
    await mount(<WorkspacePage page={page({ workspaces: [], projects })} />);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Register workspace" }),
    );
    expect(
      screen.getByText(/Everyone with access to the project sees and uses/u),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Only projects with a GitHub link can have a workspace/u,
      ),
    ).toBeVisible();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("PAGE-25 actions follow the right on each project", () => {
  it("offers edit and removal only on the workspaces of a managed project", async () => {
    await mount(
      <WorkspacePage
        page={page({
          workspaces: [
            workspace({ id: "own", name: "Own", canManage: true }),
            workspace({
              id: "foreign",
              name: "Foreign",
              projectId: "other",
              projectName: "Other",
              canManage: false,
            }),
          ],
        })}
      />,
    );
    expect(
      await screen.findByRole("button", { name: "Actions for Own" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Actions for Foreign" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Foreign")).toBeVisible();
  });

  it("explains an unusable workspace in the list", async () => {
    await mount(
      <WorkspacePage
        page={page({
          workspaces: [
            workspace({
              isUsable: false,
              reason: "workspace_project_unsupported",
              github: null,
            }),
          ],
        })}
      />,
    );
    expect(
      await screen.findByText(
        "The project needs a link to a GitHub repository.",
      ),
    ).toBeVisible();
    expect(screen.getByText("No GitHub repository configured")).toBeVisible();
  });
});

describe("PAGE-25 removal confirmation", () => {
  it("confirms before removing, tells that files and GitHub link stay and shows only kinds of references", async () => {
    const submitted: FormData[] = [];
    let usages: readonly { id: string; name: string; kind: string }[] = [
      { id: "0", name: "", kind: "plan" },
      { id: "1", name: "", kind: "run" },
    ];
    await mount(<WorkspacePage page={page()} />, {
      action: async (request) => {
        const form = await request.formData();
        submitted.push(form);
        return form.get("intent") === "workspace-usages"
          ? { ok: true, intent: "workspace-usages", workspaceUsages: usages }
          : { ok: true, intent: "delete-workspace" };
      },
    });
    const user = userEvent.setup();
    async function open(): Promise<void> {
      await user.click(
        await screen.findByRole("button", { name: "Actions for Development" }),
      );
      await user.click(
        screen.getByRole("menuitem", { name: "Remove registration" }),
      );
    }
    await open();
    const dialog = await screen.findByRole("dialog", {}, SLOW_UI_WAIT);
    expect(dialog).toHaveTextContent(
      "The directory, its files and the project's GitHub link stay unchanged.",
    );
    expect(await within(dialog).findByText("Plan")).toBeVisible();
    expect(within(dialog).getByText("Active execution")).toBeVisible();
    const confirm = within(dialog).getByRole("button", {
      name: "Remove registration",
    });
    expect(confirm).toBeDisabled();
    expect(submitted.map((form) => form.get("intent"))).toEqual([
      "workspace-usages",
    ]);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    usages = [];
    await open();
    const again = await screen.findByRole("dialog", {}, SLOW_UI_WAIT);
    await waitFor(() =>
      expect(
        within(again).getByRole("button", { name: "Remove registration" }),
      ).toBeEnabled(),
    );
    expect(
      submitted.some((form) => form.get("intent") === "delete-workspace"),
    ).toBe(false);
    await user.click(
      within(again).getByRole("button", { name: "Remove registration" }),
    );
    await waitFor(() =>
      expect(submitted.at(-1)?.get("intent")).toBe("delete-workspace"),
    );
    expect(submitted.at(-1)?.get("workspaceId")).toBe("workspace-id");
    expect(submitted.at(-1)?.get("revision")).toBe("1");
  });
});

describe("PAGE-25 workspace choice in the planning", () => {
  async function mountFields(
    workspaces: Parameters<typeof PlanFields>[0]["workspaces"],
    onChange = vi.fn(),
  ): Promise<void> {
    const i18n = await createI18n("en");
    render(
      <I18nextProvider i18n={i18n}>
        <PlanFields
          draft={emptyAgentPlan()}
          workspaces={workspaces}
          disabled={false}
          onChange={onChange}
        />
      </I18nextProvider>,
    );
  }

  const usable = {
    id: "usable",
    name: "Usable",
    path: "/approved/usable",
    projectId: "project",
    projectName: "Project",
    github,
    isUsable: true,
    reason: null,
  } as const;
  const unusable = {
    ...usable,
    id: "unusable",
    name: "Unusable",
    github: null,
    isUsable: false,
    reason: "workspace_project_unsupported",
  } as const;

  it("selects a usable workspace and leaves an unavailable one unselectable", async () => {
    const onChange = vi.fn();
    await mountFields([usable, unusable], onChange);
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Workspace" }));
    const blocked = screen.getByRole("option", {
      name: "Unusable (unavailable)",
    });
    expect(blocked).toHaveAttribute("aria-disabled", "true");
    await user.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("option", { name: "Usable" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "usable" }),
    );
  });

  it("points to the workspace section when no workspace is available", async () => {
    await mountFields([]);
    expect(
      screen.getByText(/No workspace is registered for your projects yet/u),
    ).toBeVisible();
  });
});
