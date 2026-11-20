import { RouterContextProvider } from "react-router";
import { beforeEach, expect, it, vi } from "vitest";

import { logEvent } from "@/backend/logging/Logger";
import { withPollingLogPolicy } from "@/backend/logging/PollingLogPolicy";
import { withRouteLogMetrics } from "@/backend/logging/RouteLogMetrics";

import { withLoggedRoutes } from "./LoggedRoutes";

import type {
  ActionFunction,
  LoaderFunction,
  LoaderFunctionArgs,
  ServerBuild,
} from "react-router";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

const FAILURE = new Error("boom");

function createBuild(routes: ServerBuild["routes"]): ServerBuild {
  return {
    entry: { module: { default: () => new Response("") } },
    routes,
    assets: {
      entry: { imports: [], module: "entry.js" },
      routes: {},
      url: "/manifest.js",
      version: "1",
    },
    publicPath: "/",
    assetsBuildDirectory: "build/client",
    future: {},
    ssr: true,
    isSpaMode: false,
    prerender: [],
    routeDiscovery: { mode: "lazy", manifestPath: "/__manifest" },
  };
}

function createRoutes(handlers: {
  loader?: LoaderFunction;
  action?: ActionFunction;
}): ServerBuild["routes"] {
  return {
    "routes/wiki": {
      id: "routes/wiki",
      path: "wiki",
      module: { default: () => null, ...handlers },
    },
  };
}

function createArguments(): LoaderFunctionArgs {
  return {
    request: new Request("http://pages.invalid/wiki"),
    url: new URL("http://pages.invalid/wiki"),
    pattern: "/wiki",
    params: {},
    context: new RouterContextProvider(),
  };
}

function wrappedLoader(build: ServerBuild): LoaderFunction {
  const loader = build.routes["routes/wiki"]?.module.loader;
  if (!loader) throw new Error("The loader was not wrapped.");

  return loader;
}

function wrappedAction(build: ServerBuild): ActionFunction {
  const action = build.routes["routes/wiki"]?.module.action;
  if (!action) throw new Error("The action was not wrapped.");

  return action;
}

async function captureRejection(work: () => unknown): Promise<unknown> {
  try {
    await work();
  } catch (error: unknown) {
    return error;
  }

  return undefined;
}

function loggedEvents(): string[] {
  return vi.mocked(logEvent).mock.calls.map(([event]) => event.event);
}

beforeEach(() => {
  let clockMs = 0;
  vi.spyOn(performance, "now").mockImplementation(() => {
    clockMs += 10;

    return clockMs;
  });
});

it("returns the very same build when it has no routes", () => {
  const build = createBuild({});

  expect(withLoggedRoutes(build)).toBe(build);
});

it("keeps the other build properties and skips undefined route entries", () => {
  const build = createBuild({
    ...createRoutes({ loader: () => null }),
    "routes/gone": undefined,
  });

  const logged = withLoggedRoutes(build);

  expect(logged).not.toBe(build);
  expect(logged.publicPath).toBe("/");
  expect(logged.entry).toBe(build.entry);
  expect(Object.keys(logged.routes)).toEqual(["routes/wiki"]);
});

it("keeps route properties and leaves missing handlers undefined", () => {
  const build = createBuild(createRoutes({}));

  const route = withLoggedRoutes(build).routes["routes/wiki"];

  expect(route?.path).toBe("wiki");
  expect(route?.module.default).toBe(
    build.routes["routes/wiki"]?.module.default,
  );
  expect(route?.module.loader).toBeUndefined();
  expect(route?.module.action).toBeUndefined();
});

it("passes arguments and context through and returns the loader result", async () => {
  const loader = vi.fn().mockResolvedValue({ title: "Wiki" });
  const wrapped = wrappedLoader(
    withLoggedRoutes(createBuild(createRoutes({ loader }))),
  );
  const args = createArguments();
  const context = { source: "test" };

  const result = await wrapped(args, context);

  expect(result).toEqual({ title: "Wiki" });
  expect(loader).toHaveBeenCalledWith(args, context);
});

it("counts a completed loader in the request without separate log records", async () => {
  const wrapped = wrappedLoader(
    withLoggedRoutes(createBuild(createRoutes({ loader: () => "ok" }))),
  );

  const summary = await withRouteLogMetrics(async (metrics) => {
    await wrapped(createArguments(), undefined);

    return metrics.finish();
  });

  expect(logEvent).not.toHaveBeenCalled();
  expect(summary).toMatchObject({
    routeLoaders: 1,
    routeActions: 0,
    routeHandlersCompleted: 1,
    routeHandlersFailed: 0,
    routeHandlerSlowest: "routes/wiki",
  });
});

it("counts an action under its own kind", async () => {
  const wrapped = wrappedAction(
    withLoggedRoutes(createBuild(createRoutes({ action: () => "saved" }))),
  );

  const summary = await withRouteLogMetrics(async (metrics) => {
    await wrapped(createArguments(), undefined);

    return metrics.finish();
  });

  expect(summary).toMatchObject({ routeLoaders: 0, routeActions: 1 });
});

it("logs start and completion of a loader that runs outside a request scope", async () => {
  const wrapped = wrappedLoader(
    withLoggedRoutes(createBuild(createRoutes({ loader: () => "ok" }))),
  );

  await wrapped(createArguments(), undefined);

  expect(vi.mocked(logEvent).mock.calls.map(([event]) => event)).toEqual([
    {
      level: "debug",
      event: "route.loader.started",
      component: "Routes",
      message: "Route handler started",
      metadata: { route: "routes/wiki", kind: "loader" },
    },
    {
      level: "info",
      event: "route.loader.completed",
      component: "Routes",
      message: "Route handler completed",
      metadata: { route: "routes/wiki", kind: "loader", durationMs: 20 },
    },
  ]);
});

it("names the log events of an action after the action kind", async () => {
  const wrapped = wrappedAction(
    withLoggedRoutes(createBuild(createRoutes({ action: () => "saved" }))),
  );

  await wrapped(createArguments(), undefined);

  expect(loggedEvents()).toEqual([
    "route.action.started",
    "route.action.completed",
  ]);
});

it("logs again once the request scope is already closed", async () => {
  const wrapped = wrappedLoader(
    withLoggedRoutes(createBuild(createRoutes({ loader: () => "late" }))),
  );

  await withRouteLogMetrics(async (metrics) => {
    metrics.finish();
    await wrapped(createArguments(), undefined);
  });

  expect(loggedEvents()).toEqual([
    "route.loader.started",
    "route.loader.completed",
  ]);
});

it("logs a failing loader at error level, counts it as failed and rethrows the same error", async () => {
  const wrapped = wrappedLoader(
    withLoggedRoutes(
      createBuild(
        createRoutes({
          loader: () => {
            throw FAILURE;
          },
        }),
      ),
    ),
  );

  const outcome = await withRouteLogMetrics(async (metrics) => {
    const error = await captureRejection(() =>
      wrapped(createArguments(), undefined),
    );

    return { error, summary: metrics.finish() };
  });

  expect(outcome.error).toBe(FAILURE);
  expect(outcome.summary).toMatchObject({
    routeHandlersCompleted: 0,
    routeHandlersFailed: 1,
  });
  expect(logEvent).toHaveBeenCalledTimes(1);
  expect(logEvent).toHaveBeenCalledWith({
    level: "error",
    event: "route.loader.failed",
    component: "Routes",
    message: "Route handler failed",
    error: FAILURE,
    metadata: { route: "routes/wiki", kind: "loader", durationMs: 20 },
  });
});

it("treats a thrown server error response as a failure", async () => {
  const response = new Response("down", { status: 500 });
  const wrapped = wrappedAction(
    withLoggedRoutes(
      createBuild(
        createRoutes({
          action: () => {
            throw response;
          },
        }),
      ),
    ),
  );

  const outcome = await withRouteLogMetrics(async (metrics) => {
    const error = await captureRejection(() =>
      wrapped(createArguments(), undefined),
    );

    return { error, summary: metrics.finish() };
  });

  expect(outcome.error).toBe(response);
  expect(outcome.summary).toMatchObject({ routeHandlersFailed: 1 });
  expect(loggedEvents()).toEqual(["route.action.failed"]);
});

it("logs a thrown redirect as a control response and counts it as completed", async () => {
  const redirect = new Response(null, { status: 302 });
  const wrapped = wrappedLoader(
    withLoggedRoutes(
      createBuild(
        createRoutes({
          loader: () => {
            throw redirect;
          },
        }),
      ),
    ),
  );

  const outcome = await withRouteLogMetrics(async (metrics) => {
    const error = await captureRejection(() =>
      wrapped(createArguments(), undefined),
    );

    return { error, summary: metrics.finish() };
  });

  expect(outcome.error).toBe(redirect);
  expect(outcome.summary).toMatchObject({
    routeHandlersCompleted: 1,
    routeHandlersFailed: 0,
  });
  expect(logEvent).toHaveBeenCalledWith({
    level: "info",
    event: "route.response",
    component: "Routes",
    message: "Route returned a control response",
    metadata: { route: "routes/wiki", statusCode: 302, kind: "loader" },
  });
});

it("keeps a thrown redirect silent inside a polling request", async () => {
  const wrapped = wrappedLoader(
    withLoggedRoutes(
      createBuild(
        createRoutes({
          loader: () => {
            throw new Response(null, { status: 302 });
          },
        }),
      ),
    ),
  );

  await withPollingLogPolicy(true, () =>
    captureRejection(() => wrapped(createArguments(), undefined)),
  );

  expect(loggedEvents()).toEqual(["route.loader.started"]);
});

it("still logs a thrown client error response inside a polling request", async () => {
  const wrapped = wrappedLoader(
    withLoggedRoutes(
      createBuild(
        createRoutes({
          loader: () => {
            throw new Response(null, { status: 400 });
          },
        }),
      ),
    ),
  );

  await withPollingLogPolicy(true, () =>
    captureRejection(() => wrapped(createArguments(), undefined)),
  );

  expect(vi.mocked(logEvent).mock.lastCall?.[0]).toMatchObject({
    event: "route.response",
    metadata: { route: "routes/wiki", statusCode: 400, kind: "loader" },
  });
});
