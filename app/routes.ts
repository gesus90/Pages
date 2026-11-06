import {
  index,
  layout,
  route,
  type RouteConfig,
  type RouteConfigEntry,
} from "@react-router/dev/routes";

/**
 * Which route table a build reads (PAGE-235).
 *
 * @remarks
 * - `spa`, the default: the static app. Pages use their browser module; every
 *   server resource is answered by the API, so the app forwards its requests.
 * - `api`: the server. Pages use their server module (`*-server.ts`), which
 *   holds the page's middleware, loader and action; resources are real.
 *   A page address of the API answers changes (`POST`); its document is the
 *   static app, and its data is read through the page's data endpoint.
 * - `all`: both tables side by side, only for type generation.
 */
type RouteTarget = "all" | "api" | "spa";

const ROUTE_TARGETS: readonly RouteTarget[] = ["all", "api", "spa"];

/** Browser module of every server resource in the static app. */
export const FORWARDED_RESOURCE = "routes/backend-request.ts";

/** Marks the route ids of the API table in the type-generation table. */
const SERVER_ID_SUFFIX = "-server";

/** The browser and the server module of a page; a page without server half has none. */
interface PageModules {
  readonly browser: string;
  readonly server?: string;
}

/** Declares routes for one target, see {@link RouteTarget}. */
interface RouteBuilder {
  /** A server resource: real in the API, forwarded by the static app. */
  readonly resource: (path: string, file: string) => RouteConfigEntry;
  /** A page: its browser module in the static app, its server module in the API. */
  readonly page: (
    path: string,
    modules: PageModules,
    options?: { readonly id?: string; readonly children?: RouteConfigEntry[] },
  ) => RouteConfigEntry[];
  /** A layout without a path. */
  readonly frame: (
    modules: Required<PageModules>,
    children: RouteConfigEntry[],
  ) => RouteConfigEntry;
  /** An index page. */
  readonly indexPage: (modules: PageModules) => RouteConfigEntry[];
}

function readTarget(value: string | undefined): RouteTarget {
  return ROUTE_TARGETS.find((target) => target === value) ?? "spa";
}

/** Creates the route declarations of one target. */
function createRouteBuilder(target: "api" | "spa"): RouteBuilder {
  const isApi = target === "api";
  return {
    resource: (path, file) =>
      isApi
        ? route(path, file)
        : route(path, FORWARDED_RESOURCE, { id: `forward:${path}` }),
    page: (path, modules, options = {}) => {
      if (!isApi)
        return [
          route(path, modules.browser, { id: options.id }, options.children),
        ];
      if (!modules.server) return options.children ?? [];
      return [
        route(
          path,
          modules.server,
          { id: options.id ? `${options.id}${SERVER_ID_SUFFIX}` : undefined },
          options.children,
        ),
      ];
    },
    frame: (modules, children) =>
      layout(isApi ? modules.server : modules.browser, children),
    indexPage: (modules) => {
      if (!isApi) return [index(modules.browser)];
      return modules.server ? [index(modules.server)] : [];
    },
  };
}

/** Sign-in, setup and the other routes without the workspace frame. */
function publicRoutes(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource, page, indexPage } = routes;
  return [
    ...indexPage({ browser: "routes/index.tsx" }),
    ...page("login", {
      browser: "routes/login.tsx",
      server: "routes/login-server.ts",
    }),
    ...page("change-password", {
      browser: "routes/change-password.tsx",
      server: "routes/change-password-server.ts",
    }),
    resource("logout", "routes/logout.tsx"),
    resource("set-language", "routes/set-language.tsx"),
    ...page("setup", {
      browser: "routes/setup.tsx",
      server: "routes/setup-server.ts",
    }),
    resource("app-api/root", "routes/root-data.ts"),
    resource("app-api/login", "routes/login-data.ts"),
    resource("app-api/change-password", "routes/change-password-data.ts"),
    resource("app-api/setup", "routes/setup-data.ts"),
    resource("health", "routes/health.ts"),
    resource("health/live", "routes/health-live.ts"),
    resource("favicon.ico", "routes/favicon.ts"),
    resource("api/v1/agent-assets", "routes/api-v1-agent-assets.ts"),
    resource("api/v1/pica-bridge", "routes/api-v1-pica-bridge.ts"),
    resource("api/v1/plan-bridge", "routes/api-v1-plan-bridge.ts"),
    resource(
      "api/core/v1/live-decisions",
      "routes/api-core-v1-live-decisions.ts",
    ),
    resource(
      "api/core/v1/status-access",
      "routes/api-core-v1-status-access.ts",
    ),
    resource("discord/callback", "routes/discord-callback.ts"),
    ...page("discord/result", { browser: "routes/discord-result.tsx" }),
    resource("instance-logo", "routes/instance-logo.ts"),
  ];
}

/** Resources of the workspace frame: its data, live changes, Pica. */
function workspaceResources(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource, page } = routes;
  return [
    resource("app-api/shell", "routes/shell-data.ts"),
    resource("dashboard-api/page", "routes/dashboard-data.ts"),
    resource("settings-api/ticket-assets", "routes/settings-ticket-assets.ts"),
    resource("settings-api/interpreters", "routes/settings-interpreters.ts"),
    resource("settings-api/pica-models", "routes/settings-pica-models.ts"),
    resource("account-version", "routes/account-version.ts"),
    resource("live-changes", "routes/live-changes.ts"),
    resource(
      "design-themes/:designThemeId/preview",
      "routes/design-theme-preview.ts",
    ),
    ...page("pica-tools", {
      browser: "routes/pica-tools.tsx",
      server: "routes/pica-tools-server.ts",
    }),
    resource("pica-tools-api", "routes/pica-tools-api.ts"),
    resource("pica-tools-api/access", "routes/pica-tools-data.ts"),
    resource("chat-api", "routes/chat-api.ts"),
    resource("chat-api/attachments", "routes/chat-attachments.ts"),
    resource("chat-browser-api", "routes/chat-browser-api.ts"),
    resource("chat/browser/:browserId/frame", "routes/chat-browser-frame.ts"),
    resource(
      "chat/browser/:browserId/downloads/:downloadId",
      "routes/chat-browser-download.ts",
    ),
    resource("chat/attachments/:attachmentId", "routes/chat-attachment.ts"),
    resource(
      "chat/attachments/:attachmentId/preview",
      "routes/chat-attachment-preview.ts",
    ),
    resource(
      "chat/attachments/:attachmentId/content",
      "routes/chat-attachment-content.ts",
    ),
  ];
}

/** Agent resources, workspaces and remote connections. */
function agentWorkspaceRoutes(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource, page } = routes;
  return [
    resource("agent-api/resources", "routes/agent-resources.ts"),
    resource("agent-api/definitions", "routes/agent-definitions.ts"),
    resource("agent-api/workspaces", "routes/agent-workspace-choices.ts"),
    resource("agent-api/ticket-choices", "routes/agent-ticket-choices.ts"),
    resource(
      "agent-api/workspace-folders",
      "routes/agent-workspace-folders.ts",
    ),
    resource("agent-api/workspace-page", "routes/agent-workspaces-data.ts"),
    ...page("agents/workspaces", {
      browser: "routes/agent-workspaces.tsx",
      server: "routes/agent-workspaces-server.ts",
    }),
    resource("agents/workspaces/remote", "routes/agent-remote.ts"),
    resource(
      "agents/workspaces/:workspaceId/console",
      "routes/agent-workspace-console.ts",
    ),
    resource(
      "agents/workspaces/remote/connections/:connectionId/console",
      "routes/agent-connection-console.ts",
    ),
    resource(
      "agents/workspaces/remote/connections/:connectionId/setup",
      "routes/agent-connection-setup.ts",
    ),
    ...page("agents/agents", {
      browser: "routes/page-agents.tsx",
      server: "routes/page-agents-server.ts",
    }),
  ];
}

/** Agents, run records and plans. */
function agentPlanRoutes(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource, page } = routes;
  return [
    resource(
      "agent-api/run-records/:agentId/:runId",
      "routes/agent-run-record.ts",
    ),
    ...page("agents/plans", {
      browser: "routes/agent-plans.tsx",
      server: "routes/agent-plans-server.ts",
    }),
    resource("agents/plans-api", "routes/agent-plans-data.ts"),
    resource("agent-api/plan-sources", "routes/agent-plan-sources.ts"),
    resource("agent-api/plan-templates", "routes/agent-plan-templates.ts"),
    resource("agent-api/plan-runs", "routes/agent-plan-runs.ts"),
    resource(
      "agent-api/plan-run-summaries",
      "routes/agent-plan-run-summaries.ts",
    ),
    resource(
      "agent-api/plan-runs/:runId/recovery",
      "routes/agent-plan-recovery.ts",
    ),
    resource(
      "agent-api/plan-runs/:runId/steps/:stepId/prompt",
      "routes/agent-plan-prompt.ts",
    ),
    resource(
      "agent-api/plan-runs/:runId/steps/:stepId/session",
      "routes/agent-plan-session.ts",
    ),
    resource(
      "agent-api/plan-runs/:runId/steps/:stepId/session/events",
      "routes/agent-plan-session-events.ts",
    ),
    resource(
      "agent-api/plan-runs/:runId/steps/:stepId/session/download",
      "routes/agent-plan-session-download.ts",
    ),
  ];
}

/** Dashboard, users and settings. */
function settingsRoutes(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource, page, indexPage } = routes;
  return [
    ...page("dashboard", {
      browser: "routes/dashboard.tsx",
      server: "routes/dashboard-server.ts",
    }),
    ...page("users", {
      browser: "routes/users.tsx",
      server: "routes/users-server.ts",
    }),
    resource("users-api/page", "routes/users-data.ts"),
    ...page(
      "settings",
      {
        browser: "routes/settings.tsx",
        server: "routes/settings-server.ts",
      },
      {
        children: [
          ...indexPage({ browser: "routes/settings-index.ts" }),
          ...page("profile", {
            browser: "routes/settings-profile.tsx",
            server: "routes/settings-profile-server.ts",
          }),
          ...page("connections", {
            browser: "routes/settings-connections.tsx",
            server: "routes/settings-connections-server.ts",
          }),
          ...page("system", {
            browser: "routes/settings-system.tsx",
            server: "routes/settings-system-server.ts",
          }),
          ...page("agents", {
            browser: "routes/settings-agents.tsx",
            server: "routes/settings-agents-server.ts",
          }),
          ...page("agents/tools", {
            browser: "routes/settings-agent-tools.tsx",
            server: "routes/settings-agent-tools-server.ts",
          }),
        ],
      },
    ),
    resource(
      "settings-api/agents/:connectionId/login",
      "routes/settings-agents-login.ts",
    ),
    resource("settings-api/runners", "routes/settings-runners.ts"),
    resource("settings-api/navigation", "routes/settings-data.ts"),
    resource("settings-api/profile", "routes/settings-profile-data.ts"),
    resource("settings-api/connections", "routes/settings-connections-data.ts"),
    resource("settings-api/system", "routes/settings-system-data.ts"),
    resource("settings-api/agents", "routes/settings-agents-data.ts"),
    resource("settings-api/agent-tools", "routes/settings-agent-tools-data.ts"),
    resource("settings-api/services", "routes/settings-services.ts"),
  ];
}

/** Projects, tickets and their resources. */
function projectRoutes(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource, page, frame } = routes;
  return [
    ...page("projekte", {
      browser: "routes/projects.tsx",
      server: "routes/projects-server.ts",
    }),
    ...page("projekte/:projectId", {
      browser: "routes/project-detail.tsx",
      server: "routes/project-detail-server.ts",
    }),
    resource("projekte/:projectId/icon", "routes/project-icon.ts"),
    resource("projekte/:projectId/discord", "routes/project-discord.ts"),
    resource("projekte-api/list", "routes/projects-data.ts"),
    resource(
      "projekte-api/projects/:projectId",
      "routes/project-detail-data.ts",
    ),
    resource("users/:userId/avatar", "routes/user-avatar.ts"),
    frame(
      {
        browser: "routes/tasks-layout.tsx",
        server: "routes/tasks-layout-server.ts",
      },
      [
        ...page(
          "aufgaben",
          {
            browser: "routes/tasks.tsx",
            server: "routes/tasks-server.ts",
          },
          { id: "aufgaben" },
        ),
        ...page(
          "tasks",
          {
            browser: "routes/tasks.tsx",
            server: "routes/tasks-server.ts",
          },
          { id: "tasks" },
        ),
        ...page(
          "aufgaben/:ticketKey",
          {
            browser: "routes/task-detail.tsx",
            server: "routes/task-detail-server.ts",
          },
          { id: "aufgaben-detail" },
        ),
        ...page(
          "tasks/:ticketKey",
          {
            browser: "routes/task-detail.tsx",
            server: "routes/task-detail-server.ts",
          },
          { id: "tasks-detail" },
        ),
      ],
    ),
    resource("aufgaben-api/attachments", "routes/ticket-attachments.ts"),
    resource("aufgaben-api/panel/:ticketKey", "routes/task-panel-data.ts"),
    resource("aufgaben-api/tree", "routes/tasks-layout-data.ts"),
    resource("aufgaben-api/board", "routes/tasks-data.ts"),
    resource("aufgaben-api/tickets/:ticketKey", "routes/task-detail-data.ts"),
    resource(
      "aufgaben/attachments/:attachmentId",
      "routes/ticket-attachment.ts",
    ),
  ];
}

/** Agent assets and the wiki. */
function wikiRoutes(routes: RouteBuilder): RouteConfigEntry[] {
  const { resource, page, indexPage } = routes;
  return [
    resource("agent-assets/:assetId", "routes/agent-asset.ts"),
    resource("wiki-api/attachments", "routes/wiki-attachments.ts"),
    resource("wiki/attachments/:attachmentId", "routes/wiki-attachment.ts"),
    resource("wiki-api/search", "routes/wiki-search.ts"),
    resource("wiki-api/drafts/:pageId", "routes/wiki-draft.ts"),
    resource("ticket-api/drafts/:ticketId", "routes/ticket-draft.ts"),
    resource("wiki-api/references", "routes/wiki-references.ts"),
    resource("wiki-api/link-titles", "routes/wiki-link-titles.ts"),
    resource("wiki-api/navigation", "routes/wiki-data.ts"),
    resource("wiki-api/home", "routes/wiki-home-data.ts"),
    resource("wiki-api/trash", "routes/wiki-trash-data.ts"),
    resource("wiki-api/pages/:pageId/:slug?", "routes/wiki-page-data.ts"),
    ...page(
      "wiki",
      { browser: "routes/wiki.tsx", server: "routes/wiki-server.ts" },
      {
        children: [
          ...indexPage({
            browser: "routes/wiki-home.tsx",
            server: "routes/wiki-home-server.ts",
          }),
          ...page("trash", {
            browser: "routes/wiki-trash.tsx",
            server: "routes/wiki-trash-server.ts",
          }),
          ...page(":pageId/:slug?", {
            browser: "routes/wiki-page.tsx",
            server: "routes/wiki-page-server.ts",
          }),
        ],
      },
    ),
  ];
}

/** Builds the route table of one target. */
function routeTable(target: "api" | "spa"): RouteConfigEntry[] {
  const routes = createRouteBuilder(target);
  const application: RouteConfigEntry[] = [
    ...publicRoutes(routes),
    routes.frame(
      {
        browser: "routes/authenticated.tsx",
        server: "routes/authenticated-server.ts",
      },
      [
        ...workspaceResources(routes),
        ...agentWorkspaceRoutes(routes),
        ...agentPlanRoutes(routes),
        ...settingsRoutes(routes),
        ...projectRoutes(routes),
        ...wikiRoutes(routes),
      ],
    ),
  ];
  // The root route is shared; the API runs its request middleware in a layout.
  return target === "api"
    ? [layout("routes/root-server.ts", application)]
    : application;
}

/** Selects the table of a build from `PAGES_ROUTES`, see {@link RouteTarget}. */
function selectRouteTable(target: RouteTarget): RouteConfigEntry[] {
  if (target !== "all") return routeTable(target);
  return [...routeTable("spa"), ...routeTable("api")];
}

export default selectRouteTable(
  readTarget(process.env.PAGES_ROUTES),
) satisfies RouteConfig;
