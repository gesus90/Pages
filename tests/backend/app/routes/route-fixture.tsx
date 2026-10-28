import { render } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import {
  createMemoryRouter,
  Outlet,
  RouterContextProvider,
  RouterProvider,
} from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { createI18n } from "@/app/lib/i18n";

import type { RenderResult } from "@testing-library/react";
import type { HeadersArgs, RouteObject } from "react-router";
import type { AccountAccess } from "@/definition/Authorization";
import type { User } from "@/definition/User";

/** The translations every rendered route reads, in English. */
export const i18n = createI18n("en");

/** A signed-in account without special rights. */
export const ACTOR: User = {
  id: "user-1",
  username: "ada",
  displayName: "Ada Lovelace",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

/**
 * The account facts of {@link ACTOR}, an active employee without a role.
 *
 * @param overrides - Facts that deviate.
 */
export function accountAccess(
  overrides: Partial<AccountAccess> = {},
): AccountAccess {
  return {
    userId: ACTOR.id,
    role: null,
    isAdmin: false,
    mode: "role",
    firstName: "Ada",
    lastName: "Lovelace",
    isActive: true,
    departments: [],
    managedDepartments: [],
    allDepartments: false,
    allProjects: false,
    hasHadDepartment: false,
    ...overrides,
  };
}

/** The argument object React Router hands to a loader or an action. */
export interface RouteArguments<Params> {
  readonly request: Request;
  readonly context: RouterContextProvider;
  readonly params: Params;
  readonly url: URL;
  readonly pattern: string;
}

/** Options of {@link routeArguments}. */
export interface RouteArgumentOptions {
  /** Signed-in user of the route context; absent leaves the context empty. */
  readonly user?: User | null;
  /** A context prepared by the test, used instead of a fresh one. */
  readonly context?: RouterContextProvider;
}

/**
 * Builds loader or action arguments with path parameters.
 *
 * @param request - Request the route answers.
 * @param params - Path parameters of the route.
 * @param options - User or a prepared context.
 */
export function routeArgumentsWith<Params>(
  request: Request,
  params: Params,
  options: RouteArgumentOptions = {},
): RouteArguments<Params> {
  const context = options.context ?? new RouterContextProvider();
  if (options.user !== undefined)
    context.set(authenticatedUserContext, options.user);
  return {
    context,
    params,
    pattern: "/synthetic",
    request,
    url: new URL(request.url),
  };
}

/**
 * Builds loader or action arguments for a route without path parameters.
 *
 * @param request - Request the route answers.
 * @param options - User or a prepared context.
 */
export function routeArguments(
  request: Request,
  options: RouteArgumentOptions = {},
): RouteArguments<Record<string, never>> {
  return routeArgumentsWith(request, {}, options);
}

/**
 * A request to the synthetic Pages origin.
 *
 * @param path - Path with query.
 * @param init - Method, headers and body.
 */
export function pagesRequest(path: string, init?: RequestInit): Request {
  return new Request(`http://pages.invalid${path}`, init);
}

/**
 * A same-origin form post.
 *
 * @param path - Path with query.
 * @param fields - Form fields.
 */
export function formPost(
  path: string,
  fields: Record<string, string> = {},
): Request {
  return pagesRequest(path, {
    method: "POST",
    headers: { Origin: "http://pages.invalid" },
    body: new URLSearchParams(fields),
  });
}

/**
 * Runs a route function and returns the response it threw or returned.
 *
 * @param work - The pending loader or action result.
 */
export async function responseOf(work: Promise<unknown>): Promise<Response> {
  try {
    const result = await work;
    if (result instanceof Response) return result;
  } catch (error: unknown) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("Expected a response.");
}

/**
 * The arguments React Router hands to a `headers` export.
 *
 * @param parentHeaders - Headers the parent routes already set.
 */
export function headerArguments(parentHeaders: HeadersInit = {}): HeadersArgs {
  return {
    actionHeaders: new Headers(),
    errorHeaders: undefined,
    loaderHeaders: new Headers(),
    parentHeaders: new Headers(parentHeaders),
  };
}

/** Options of {@link renderRoute}. */
export interface RenderRouteOptions {
  /** Data the route's loader delivered. */
  readonly loaderData?: unknown;
  /** Data of the last action submission. */
  readonly actionData?: unknown;
  /** Address the router opens. */
  readonly url?: string;
  /** Path pattern of the route. */
  readonly path?: string;
  /** Loader the route revalidates with; it answers with the loader data by default. */
  readonly loader?: RouteObject["loader"];
  /** Action the route answers submissions with. */
  readonly action?: RouteObject["action"];
  /** A parent route whose loader data the route reads by id. */
  readonly parent?: { readonly id: string; readonly loaderData: unknown };
  /** Error boundary of the route. */
  readonly ErrorBoundary?: React.ComponentType;
  /** A loader failure the route starts with, shown by its error boundary. */
  readonly error?: unknown;
  /** Child routes rendered into an outlet of the route. */
  readonly children?: RouteObject[];
}

/**
 * Renders a route component in a memory router with English translations.
 *
 * @param Component - The route component.
 * @param options - Loader and action data, address and surrounding routes.
 * @returns The rendering and the router it runs in.
 */
export function renderRoute(
  Component: React.ComponentType,
  options: RenderRouteOptions = {},
): RenderResult & { readonly router: ReturnType<typeof createMemoryRouter> } {
  const route: RouteObject = {
    id: "route",
    path: options.path ?? "/",
    Component,
    ErrorBoundary: options.ErrorBoundary,
    loader: options.loader ?? ((): unknown => options.loaderData ?? null),
    action: options.action,
    children: options.children,
  };
  const routes: RouteObject[] = options.parent
    ? [
        {
          id: options.parent.id,
          Component: Outlet,
          loader: () => options.parent?.loaderData ?? null,
          children: [route],
        },
      ]
    : [route];
  const loaderData: Record<string, unknown> = {
    route: options.loaderData ?? null,
  };
  if (options.parent) loaderData[options.parent.id] = options.parent.loaderData;
  const router = createMemoryRouter(routes, {
    initialEntries: [options.url ?? "/"],
    hydrationData: {
      loaderData,
      ...(options.actionData === undefined
        ? {}
        : { actionData: { route: options.actionData } }),
      ...(options.error === undefined
        ? {}
        : { errors: { route: options.error } }),
    },
  });
  return {
    ...render(
      <I18nextProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nextProvider>,
    ),
    router,
  };
}
