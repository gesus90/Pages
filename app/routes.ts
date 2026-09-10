import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

export default [
  index("routes/index.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("set-language", "routes/set-language.tsx"),
  layout("routes/authenticated.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("users", "routes/users.tsx"),
    route("settings", "routes/settings.tsx"),
    route("projekte", "routes/projects.tsx"),
    route("projekte/:projectId", "routes/project-detail.tsx"),
    route("projekte/:projectId/icon", "routes/project-icon.ts"),
    route("aufgaben", "routes/tasks.tsx", { id: "aufgaben" }),
    route("tasks", "routes/tasks.tsx", { id: "tasks" }),
    route("aufgaben/:ticketKey", "routes/task-detail.tsx", {
      id: "aufgaben-detail",
    }),
    route("tasks/:ticketKey", "routes/task-detail.tsx", {
      id: "tasks-detail",
    }),
    route("wiki", "routes/wiki.tsx"),
  ]),
] satisfies RouteConfig;
