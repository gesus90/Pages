import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("login", "routes/login.tsx"),
  route("change-password", "routes/change-password.tsx"),
  route("logout", "routes/logout.tsx"),
  route("set-language", "routes/set-language.tsx"),
  route("setup", "routes/setup.tsx"),
  route("health", "routes/health.ts"),
  route("instance-logo", "routes/instance-logo.ts"),
  layout("routes/authenticated.tsx", [
    route("account-version", "routes/account-version.ts"),
    route("assistant-api", "routes/text-assistant.ts"),
    route("dashboard", "routes/dashboard.tsx"),
    route("users", "routes/users.tsx"),
    route("settings", "routes/settings.tsx", [
      index("routes/settings-index.ts"),
      route("profile", "routes/settings-profile.tsx"),
      route("system", "routes/settings-system.tsx"),
      route("agents", "routes/settings-agents.tsx"),
    ]),
    route(
      "settings-api/agents/:connectionId/login",
      "routes/settings-agents-login.ts",
    ),
    route("projekte", "routes/projects.tsx"),
    route("projekte/:projectId", "routes/project-detail.tsx"),
    route("projekte/:projectId/icon", "routes/project-icon.ts"),
    route("users/:userId/avatar", "routes/user-avatar.ts"),
    layout("routes/tasks-layout.tsx", [
      route("aufgaben", "routes/tasks.tsx", { id: "aufgaben" }),
      route("tasks", "routes/tasks.tsx", { id: "tasks" }),
      route("aufgaben/:ticketKey", "routes/task-detail.tsx", {
        id: "aufgaben-detail",
      }),
      route("tasks/:ticketKey", "routes/task-detail.tsx", {
        id: "tasks-detail",
      }),
    ]),
    route("aufgaben-api/attachments", "routes/ticket-attachments.ts"),
    route("aufgaben/attachments/:attachmentId", "routes/ticket-attachment.ts"),
    route("wiki-api/attachments", "routes/wiki-attachments.ts"),
    route("wiki/attachments/:attachmentId", "routes/wiki-attachment.ts"),
    route("wiki-api/search", "routes/wiki-search.ts"),
    route("wiki-api/references", "routes/wiki-references.ts"),
    route("wiki-api/link-titles", "routes/wiki-link-titles.ts"),
    route("wiki", "routes/wiki.tsx", [
      index("routes/wiki-home.tsx"),
      route("trash", "routes/wiki-trash.tsx"),
      route(":pageId/:slug?", "routes/wiki-page.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
