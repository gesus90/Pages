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
  layout("routes/authenticated.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("settings", "routes/settings.tsx"),
    route("projects", "routes/projects.tsx"),
    route("projects/:projectId", "routes/project.tsx"),
    route("tasks", "routes/tasks.tsx"),
    route("wiki", "routes/wiki.tsx"),
  ]),
] satisfies RouteConfig;
