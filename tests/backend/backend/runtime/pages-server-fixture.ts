import { Server } from "node:http";

import { vi } from "vitest";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { PagesRuntime } from "@/backend/runtime/PagesRuntime";

import type { PagesConfig } from "@/backend/config/PagesConfig";
import type { ServerBuild } from "react-router";
import type { Mock } from "vitest";

/** A server build that only has to be passed along. */
export const SERVER_BUILD: ServerBuild = {
  assets: {
    entry: { imports: [], module: "/assets/entry.js" },
    routes: {},
    url: "/assets/manifest.js",
    version: "1",
  },
  assetsBuildDirectory: "build/client",
  entry: {
    module: { default: async () => new Response("unused") },
  },
  future: {},
  isSpaMode: false,
  prerender: [],
  publicPath: "/",
  routeDiscovery: { manifestPath: "/__manifest", mode: "lazy" },
  routes: {},
  ssr: true,
};

/** A runtime on a configuration file whose `update` is observable. */
export interface RuntimeWithFile {
  readonly runtime: PagesRuntime;
  readonly update: Mock<ConfigFile["update"]>;
}

/** Builds a runtime whose configuration file never touches the disk. */
export function createRuntime(config: PagesConfig): RuntimeWithFile {
  const file = new ConfigFile("/srv/pages/config.toml");
  const update = vi.spyOn(file, "update").mockResolvedValue(config);

  return { runtime: new PagesRuntime(file, config), update };
}

/** How the fake server reacts to `listen`. */
export interface ListenOutcome {
  readonly error?: Error;
}

/** A real server object that never opens a socket. */
export function createFakeServer(outcome: ListenOutcome = {}): {
  readonly server: Server;
  readonly listenedPorts: number[];
} {
  const server = new Server();
  const listenedPorts: number[] = [];

  vi.spyOn(server, "listen").mockImplementation(
    (...parameters: unknown[]): Server => {
      const port = parameters[0];
      // `listen(port, address, callback)`: the address may be absent.
      const callback = parameters.find(
        (parameter) => typeof parameter === "function",
      );

      if (typeof port === "number") {
        listenedPorts.push(port);
      }

      queueMicrotask(() => {
        if (outcome.error !== undefined) {
          server.emit("error", outcome.error);
        } else if (typeof callback === "function") {
          callback();
        }
      });

      return server;
    },
  );

  return { listenedPorts, server };
}

/** Builds the error `listen` reports for a port that cannot be used. */
export function listenError(code: string): Error {
  return Object.assign(new Error(`listen ${code}`), { code });
}
