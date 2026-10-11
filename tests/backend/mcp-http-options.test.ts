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

  it.each([
    "10.0.0.0",
    "10.0.0.5",
    "10.255.255.255",
    "172.16.0.0",
    "172.20.0.52",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.0.52",
    "192.168.255.255",
  ])("accepts the private IPv4 host %s with an HTTP resource", (host) => {
    const configuration = read(
      "--host",
      host,
      "--port",
      "8998",
      "--resource",
      `http://${host}:8998/mcp`,
    );
    expect(configuration.host).toBe(host);
    expect(configuration.port).toBe(8998);
    expect(configuration.resource.href).toBe(`http://${host}:8998/mcp`);
  });

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
    "8.8.8.8",
    "9.255.255.255",
    "11.0.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "192.167.255.255",
    "192.169.0.0",
    "169.254.1.20",
    "100.64.0.1",
    "192.168.0.256",
    "192.168.0",
    "192.168.000.52",
    "0xc0a80034",
    "::ffff:192.168.0.52",
    "127.0.0.2",
    "[::1]",
    "LOCALHOST",
    "localhost.",
    "mcp.invalid",
    "",
    " 127.0.0.1",
  ])("rejects the disallowed host %j with a fixed message", (host) => {
    const failure = readFailure(["--http", ...resourceOptions, "--host", host]);
    expect(failure).toBeInstanceOf(HttpOptionError);
    expect(failure.message).toBe(
      "--host accepts only 127.0.0.1, ::1, localhost or a private IPv4 address (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).",
    );
  });
});

describe("HTTP resource options", () => {
  it.each(["127.0.0.1", "localhost", "[::1]"])(
    "still accepts an HTTP resource on loopback %s",
    (host) => {
      const configuration = read("--resource", `http://${host}:8998/mcp`);
      expect(configuration.resource.href).toBe(`http://${host}:8998/mcp`);
    },
  );

  it.each([
    "8.8.8.8",
    "172.15.255.255",
    "172.32.0.0",
    "192.169.0.52",
    "169.254.1.20",
    "100.64.0.1",
    "127.0.0.2",
    "0.0.0.0",
    "[::]",
    "[2001:db8::1]",
    "mcp.invalid",
    "intranet.invalid",
  ])("requires HTTPS for the non-local resource host %s", (host) => {
    expect(() => read("--resource", `http://${host}/mcp`)).toThrow(
      HttpOptionError,
    );
    expect(read("--resource", `https://${host}/mcp`).resource.href).toBe(
      `https://${host}/mcp`,
    );
  });

  it.each([
    "",
    "invalid",
    " http://192.168.0.52:8998/mcp",
    "http://192.168.0.52:8998/mcp ",
    "ftp://192.168.0.52/mcp",
    "http://user@192.168.0.52/mcp",
    "http://:password@192.168.0.52/mcp",
    "http://192.168.0.52/mcp?query=1",
    "http://192.168.0.52/mcp#fragment",
    "http://192.168.0.52/other",
  ])("keeps rejecting an unsafe resource %j", (resource) => {
    expect(() => read("--resource", resource)).toThrow(HttpOptionError);
  });

  it("preserves resource normalization and the loopback default", () => {
    const configuration = read("--resource", "http://192.168.0.52:8998/mcp/");
    expect(configuration.resource.href).toBe("http://192.168.0.52:8998/mcp");
    expect(configuration.host).toBe("127.0.0.1");
  });

  it("does not extend the HTTP exception to the Pages OAuth issuer", () => {
    const failure = readFailure(
      ["--http", "--resource", "http://192.168.0.52:8998/mcp"],
      { PAGES_URL: "http://192.168.0.52:3000" },
    );
    expect(failure).not.toBeInstanceOf(HttpOptionError);
    expect(failure.message).toContain("PAGES_URL requires HTTPS");
  });
});

describe("HTTP option diagnostics", () => {
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
    const usage = "Use --http --resource URL [--port PORT] [--host HOST].";
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
