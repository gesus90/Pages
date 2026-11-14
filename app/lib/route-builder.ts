import type { RouteConfigEntry } from "@react-router/dev/routes";

/** The browser and the server module of a page; a page without server half has none. */
export interface PageModules {
  readonly browser: string;
  readonly server?: string;
}

/** Declares routes for one target, see {@link RouteTarget}. */
export interface RouteBuilder {
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
