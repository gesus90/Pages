import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import manifest from "../../package.json" with { type: "json" };
import {
  FIXTURE_SECRET,
  FIXTURE_TOKEN,
  PagesFixture,
} from "./pages-fixture.ts";
import { spawnBundle, stopServer, StdioCheckError } from "./server.ts";
import { isRecord, PROTOCOL_VERSION, StdioClient } from "./stdio-client.ts";

import type { RunningServer } from "./server.ts";
import type { StdioResponse } from "./stdio-client.ts";

const BUNDLE = fileURLToPath(
  new URL(`../../dist/pages-mcp-v${manifest.version}.cjs`, import.meta.url),
);
const AUTHORIZATION_FAILURE = "Pages authorization failed.";
const TOOL_ARGUMENTS = { ticketId: 'PAGE-1 ä"\n', cursor: "c/1" };

/** The bundle's streams, read separately from the protocol. */
interface Streams {
  stdout: string;
  stderr: string;
}

/**
 * The child's whole environment: nothing of the caller, so an ambient
 * `PAGES_URL` or credential can neither reach Pages nor the local store.
 */
function childEnvironment(
  scratch: string,
  overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: scratch,
    XDG_CONFIG_HOME: path.join(scratch, "config"),
    XDG_DATA_HOME: path.join(scratch, "data"),
    XDG_STATE_HOME: path.join(scratch, "state"),
    ...overrides,
  };
}

function capture(server: RunningServer): Streams {
  const streams: Streams = { stdout: "", stderr: "" };
  server.child.stdout.on("data", (chunk: Buffer) => {
    streams.stdout += chunk.toString("utf8");
  });
  server.child.stderr.on("data", (chunk: Buffer) => {
    streams.stderr += chunk.toString("utf8");
  });
  return streams;
}

function toolText(response: StdioResponse): {
  readonly text: string;
  readonly isError: boolean;
} {
  assert.ok(isRecord(response.result), "tools/call returned no result");
  const { content, isError } = response.result;
  assert.ok(Array.isArray(content) && content.length === 1);
  const [entry] = content as unknown[];
  assert.ok(isRecord(entry) && entry.type === "text");
  assert.equal(typeof entry.text, "string");
  return { text: String(entry.text), isError: isError === true };
}

async function callTool(
  client: StdioClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<StdioResponse> {
  return client.exchange("tools/call", { name, arguments: parameters });
}

async function checkHandshake(
  client: StdioClient,
  fixture: PagesFixture,
): Promise<void> {
  const { result } = await client.exchange("initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "pages-mcp-mock-e2e", version: manifest.version },
  });
  assert.ok(isRecord(result) && isRecord(result.serverInfo));
  assert.equal(result.protocolVersion, PROTOCOL_VERSION);
  assert.equal(result.serverInfo.name, "pages-mcp");
  assert.equal(result.serverInfo.version, manifest.version);
  await client.initialized();

  const listed = await client.exchange("tools/list", {});
  assert.ok(isRecord(listed.result) && Array.isArray(listed.result.tools));
  const names = (listed.result.tools as readonly { readonly name: string }[])
    .map((tool) => tool.name)
    .sort();
  // Only what Pages offers and the package knows; never `fixture.unknown`.
  assert.deepEqual(names, ["list_project_names", "read_ticket"]);
  const ticketTool = (
    listed.result.tools as readonly Record<string, unknown>[]
  ).find((tool) => tool.name === "read_ticket");
  assert.ok(ticketTool && isRecord(ticketTool.inputSchema));
  assert.deepEqual(ticketTool.inputSchema.required, ["ticketId"]);
  assert.equal(ticketTool.inputSchema.additionalProperties, false);

  const [verify] = fixture.requestsOf("verify");
  assert.ok(verify, "the adapter did not verify the credential");
  assert.equal(verify.method, "POST");
  assert.equal(verify.path, "/api/v1/agents");
  assert.equal(verify.authorization, `Bearer ${FIXTURE_TOKEN}`);
  assert.equal(verify.contentType, "application/json");
}

async function checkRouting(
  client: StdioClient,
  fixture: PagesFixture,
): Promise<void> {
  const names = toolText(await callTool(client, "list_project_names", {}));
  assert.deepEqual(JSON.parse(names.text), ["Fixture Ä", "Fixture B"]);
  assert.deepEqual(
    fixture.requestsOf("projects.names.list").at(-1)?.parameters,
    {},
  );

  const ticket = toolText(
    await callTool(client, "read_ticket", TOOL_ARGUMENTS),
  );
  assert.equal(ticket.isError, false);
  // Arguments survive the whole way out and the answer the whole way back.
  assert.deepEqual(
    fixture.requestsOf("ticket.read").at(-1)?.parameters,
    TOOL_ARGUMENTS,
  );
  assert.deepEqual(JSON.parse(ticket.text), { echoed: TOOL_ARGUMENTS });
}

async function checkRefusals(
  client: StdioClient,
  fixture: PagesFixture,
): Promise<void> {
  const namesBefore = fixture.requestsOf("projects.names.list").length;
  const withArguments = await callTool(client, "list_project_names", { a: 1 });
  assert.equal(
    withArguments.error?.message.includes("takes no arguments"),
    true,
  );
  assert.equal(fixture.requestsOf("projects.names.list").length, namesBefore);

  const unknown = await callTool(client, "no_such_tool", {});
  assert.equal(unknown.error?.message.includes("Unknown tool."), true);
}

/** Pages decides on every call: a right it withdrew stops the tool without a request. */
async function checkWithdrawnRight(
  client: StdioClient,
  fixture: PagesFixture,
): Promise<void> {
  const offered = fixture.offeredOperations;
  const reads = fixture.requestsOf("ticket.read").length;
  fixture.offeredOperations = offered.filter(
    (operation) => operation !== "ticket.read",
  );
  const refused = await callTool(client, "read_ticket", TOOL_ARGUMENTS);
  assert.equal(refused.error?.message.includes(AUTHORIZATION_FAILURE), true);
  assert.equal(fixture.requestsOf("ticket.read").length, reads);
  fixture.offeredOperations = offered;
}

async function checkFailures(
  client: StdioClient,
  fixture: PagesFixture,
): Promise<void> {
  fixture.outcome = "not_found";
  const missing = toolText(
    await callTool(client, "read_ticket", TOOL_ARGUMENTS),
  );
  assert.equal(missing.isError, true);
  assert.equal(
    (JSON.parse(missing.text) as { code: string }).code,
    "NOT_FOUND",
  );

  // Pages judges the arguments; its refusal must reach the client as a tool error.
  fixture.outcome = "invalid_request";
  const invalid = toolText(
    await callTool(client, "read_ticket", { ticketId: 1 }),
  );
  assert.equal(invalid.isError, true);
  assert.equal(
    (JSON.parse(invalid.text) as { code: string }).code,
    "INVALID_REQUEST",
  );
  assert.deepEqual(fixture.requestsOf("ticket.read").at(-1)?.parameters, {
    ticketId: 1,
  });

  for (const outcome of [
    "server_error",
    "unauthorized",
    "invalid_json",
  ] as const) {
    fixture.outcome = outcome;
    const failed = await callTool(client, "read_ticket", TOOL_ARGUMENTS);
    assert.equal(
      failed.error?.message.includes(AUTHORIZATION_FAILURE),
      true,
      outcome,
    );
    assert.equal(
      JSON.stringify(failed).includes(FIXTURE_SECRET),
      false,
      outcome,
    );
  }

  // A redirect could carry the credential elsewhere, so it is never followed.
  fixture.outcome = "redirect";
  const redirected = await callTool(client, "read_ticket", TOOL_ARGUMENTS);
  assert.equal(
    redirected.error?.message.includes("Could not reach the Pages agent API"),
    true,
  );
  assert.equal(fixture.redirectsFollowed, 0);

  fixture.outcome = "connection_lost";
  const lost = await callTool(client, "read_ticket", TOOL_ARGUMENTS);
  assert.equal(
    lost.error?.message.includes("Could not reach the Pages agent API"),
    true,
  );
}

/** The whole session against one real bundle process over its real stdio. */
async function checkSession(scratch: string): Promise<void> {
  const fixture = new PagesFixture();
  await fixture.start();
  const server = spawnBundle(
    BUNDLE,
    childEnvironment(scratch, {
      PAGES_URL: fixture.url,
      PAGES_TOKEN: FIXTURE_TOKEN,
    }),
  );
  const streams = capture(server);
  const client = new StdioClient(server);
  try {
    await checkHandshake(client, fixture);
    await checkRouting(client, fixture);
    await checkRefusals(client, fixture);
    await checkWithdrawnRight(client, fixture);
    await checkFailures(client, fixture);
    // Requires protocol-only stdout, complete frames and exit code 0.
    await client.finish();
    assert.equal(streams.stdout.includes(FIXTURE_TOKEN), false);
    assert.equal(streams.stderr.includes(FIXTURE_TOKEN), false);
    assert.equal(streams.stderr.includes(FIXTURE_SECRET), false);
  } finally {
    client.dispose();
    await stopServer(server);
    await fixture.stop();
  }
}

/** Runs the bundle until it gives up at startup and returns its streams. */
async function failedStart(environment: NodeJS.ProcessEnv): Promise<Streams> {
  const server = spawnBundle(BUNDLE, environment);
  const streams = capture(server);
  server.child.stdin.end();
  const exit = await server.closed;
  assert.equal(exit.code, 1, "a failed start must end with exit code 1");
  assert.equal(streams.stdout, "", "a failed start must not write to stdout");
  assert.equal(streams.stderr.includes(FIXTURE_TOKEN), false);
  assert.equal(streams.stderr.includes(FIXTURE_SECRET), false);
  return streams;
}

async function checkStartFailures(scratch: string): Promise<void> {
  const fixture = new PagesFixture();
  await fixture.start();
  const unreachable = fixture.url;
  fixture.verifyOutcome = "unauthorized";
  try {
    const rejected = await failedStart(
      childEnvironment(scratch, {
        PAGES_URL: fixture.url,
        PAGES_TOKEN: FIXTURE_TOKEN,
      }),
    );
    assert.match(rejected.stderr, /Startup failed/u);
    const noCredential = await failedStart(
      childEnvironment(scratch, { PAGES_URL: fixture.url }),
    );
    assert.match(noCredential.stderr, /No paired credential/u);
    const noAddress = await failedStart(childEnvironment(scratch, {}));
    assert.match(noAddress.stderr, /\[pages-mcp\]/u);
  } finally {
    await fixture.stop();
  }
  const down = await failedStart(
    childEnvironment(scratch, {
      PAGES_URL: unreachable,
      PAGES_TOKEN: FIXTURE_TOKEN,
    }),
  );
  assert.match(down.stderr, /Could not reach the Pages agent API/u);
}

async function run(): Promise<void> {
  const scratch = await mkdtemp(path.join(tmpdir(), "pages-mcp-e2e-"));
  try {
    await checkSession(scratch);
    await checkStartFailures(scratch);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
  console.error(
    "[pages-mcp mock e2e] Passed: real bundle over stdio against the synthetic Pages fixture: handshake, tools/list, routing, serialization, auth, refusals, failure mapping, start failures, exit codes.",
  );
}

try {
  await run();
} catch (error: unknown) {
  const message =
    error instanceof StdioCheckError || error instanceof assert.AssertionError
      ? error.message
      : "Unexpected failure of the mocked stdio check.";
  console.error(`[pages-mcp mock e2e] Failed: ${message}`);
  process.exitCode = 1;
}
