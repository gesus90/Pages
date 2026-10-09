import { readConfiguration } from "./configuration.js";

/** Explicit HTTP audience and Pages issuer; no personal token participates in HTTP mode. */
export interface HttpConfiguration {
  readonly issuer: string;
  readonly agentsUrl: URL;
  readonly resource: URL;
  readonly port: number;
}

/** Reads the HTTP mode flag, public resource and port, retaining the secure Pages URL rules. */
export function readHttpConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  argumentsList: readonly string[],
): HttpConfiguration {
  if (argumentsList.length !== 3 && argumentsList.length !== 5)
    throw new Error("Use --http --resource URL [--port PORT].");
  if (
    argumentsList[0] !== "--http" ||
    argumentsList[1] !== "--resource" ||
    (argumentsList.length === 5 && argumentsList[3] !== "--port")
  ) {
    throw new Error("Use --http --resource URL [--port PORT].");
  }
  const pages = readConfiguration({
    PAGES_URL: environment.PAGES_URL,
    PAGES_TOKEN: "configuration-only",
  });
  const resourceConfiguration = readConfiguration({
    PAGES_URL: argumentsList[2],
    PAGES_TOKEN: "configuration-only",
  });
  const resource = new URL(
    resourceConfiguration.agentsUrl.href.replace(/\/api\/v1\/agents$/, ""),
  );
  const port = argumentsList.length === 5 ? Number(argumentsList[4]) : 8998;
  if (
    resource.pathname !== "/mcp" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    pages.agentsUrl.pathname !== "/api/v1/agents"
  ) {
    throw new Error(
      "HTTP mode requires a /mcp resource, an instance origin and a valid port.",
    );
  }
  return {
    issuer: pages.agentsUrl.origin,
    agentsUrl: pages.agentsUrl,
    resource,
    port,
  };
}
