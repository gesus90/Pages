import { describe, expect, it } from "vitest";

import {
  HttpOptionError,
  readHttpConfiguration,
} from "../../mcp/src/http-configuration";

const environment = { PAGES_URL: "https://pages.invalid" };
const resourceOptions = ["--resource", "https://mcp.invalid/mcp"];

function read(...options: string[]): ReturnType<typeof readHttpConfiguration> {
  return readHttpConfiguration(environment, ["--http", ...options]);
}

function readFailure(
  argumentsList: string[],
  variables: Record<string, string> = environment,
): Error {
  try {
    readHttpConfiguration(variables, argumentsList);
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error("Expected the HTTP options to be rejected.");
}

describe("HTTP listener options", () => {
  it("defaults to the loopback address 127.0.0.1 on port 8998", () => {
    const configuration = read(...resourceOptions);
    expect(configuration.host).toBe("127.0.0.1");
    expect(configuration.port).toBe(8998);
  });

  it.each(["127.0.0.1", "::1", "localhost"])(
    "accepts the loopback host %s together with a chosen port",
    (host) => {
      const configuration = read(
        "--host",
        host,
        ...resourceOptions,
        "--port",
        "9001",
      );
      expect(configuration.host).toBe(host);
      expect(configuration.port).toBe(9001);
    },
  );

  it("accepts the options in any order", () => {
    const configuration = read(
      "--port",
      "9002",
      "--host",
      "::1",
      ...resourceOptions,
    );
    expect(configuration).toMatchObject({ host: "::1", port: 9002 });
    expect(configuration.resource.href).toBe("https://mcp.invalid/mcp");
    expect(configuration.issuer).toBe("https://pages.invalid");
  });

  it.each([
    "0.0.0.0",
    "::",
    "192.168.1.20",
    "10.0.0.5",
    "127.0.0.2",
    "[::1]",
    "LOCALHOST",
    "localhost.",
    "mcp.invalid",
    "",
    " 127.0.0.1",
  ])("rejects the non-loopback host %j with a fixed message", (host) => {
    const failure = readFailure(["--http", ...resourceOptions, "--host", host]);
    expect(failure).toBeInstanceOf(HttpOptionError);
    expect(failure.message).toBe(
      "--host accepts only 127.0.0.1, ::1 or localhost; remote access needs a TLS reverse proxy.",
    );
  });

  it("never repeats an option value or the Pages URL in a failure", () => {
    const secretHost = "sentinel-secret.invalid";
    const failures = [
      readFailure(["--http", ...resourceOptions, "--host", secretHost]),
      readFailure(["--http", ...resourceOptions, "--port", secretHost]),
      readFailure(["--http", "--resource", `https://${secretHost}/wrong`]),
      readFailure([
        "--http",
        "--resource",
        `https://user:${secretHost}@mcp.invalid/mcp`,
      ]),
      readFailure(["--http", ...resourceOptions, secretHost, "1"]),
      readFailure(["--http", ...resourceOptions], {
        PAGES_URL: `https://${secretHost}/prefix`,
      }),
    ];
    for (const failure of failures) {
      expect(failure.message).not.toContain("sentinel-secret");
    }
  });

  it("explains each rejected combination", () => {
    const usage =
      "Use --http --resource URL [--port PORT] [--host 127.0.0.1|::1|localhost].";
    expect(readFailure([]).message).toBe(usage);
    expect(readFailure(["--http"]).message).toBe(usage);
    expect(readFailure(["--host", "::1", ...resourceOptions]).message).toBe(
      usage,
    );
    expect(readFailure(["--http", ...resourceOptions, "--host"]).message).toBe(
      usage,
    );
    expect(
      readFailure(["--http", ...resourceOptions, "--port", "1", "--port", "2"])
        .message,
    ).toBe(usage);
    expect(
      readFailure(["--http", ...resourceOptions, "--bind", "127.0.0.1"])
        .message,
    ).toBe(usage);
    expect(readFailure(["--http", "--port", "9000"]).message).toBe(usage);
    expect(
      readFailure(["--http", "--resource", "ftp://mcp.invalid/mcp"]).message,
    ).toContain("--resource must be an HTTPS");
    expect(
      readFailure(["--http", "--resource", "https://mcp.invalid/other"])
        .message,
    ).toContain("--resource must be an HTTPS");
    expect(
      readFailure(["--http", ...resourceOptions, "--port", "70000"]).message,
    ).toBe("--port must be an integer from 1 to 65535.");
    expect(
      readFailure(["--http", ...resourceOptions], {
        PAGES_URL: "https://pages.invalid/prefix",
      }).message,
    ).toBe(
      "In HTTP mode PAGES_URL must be the instance origin without a path.",
    );
  });

  it("keeps a missing Pages URL a plain configuration error", () => {
    const failure = readFailure(["--http", ...resourceOptions], {});
    expect(failure).not.toBeInstanceOf(HttpOptionError);
    expect(failure.message).toContain("PAGES_URL");
  });
});
