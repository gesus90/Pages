import { beforeEach, expect, it, vi } from "vitest";

import { remoteConsoleAction } from "@/app/lib/remote-console-route.server";
import { RemoteError } from "@/backend/error/RemoteErrors";

import { EMPLOYEE, SYNTHETIC_ORIGIN } from "../server-lib/request-fixtures";

import type { RemoteConsoleScope } from "@/backend/service/remote/RemoteConsoleService";
import type { User } from "@/definition/User";

const consoles = vi.hoisted(() => ({
  close: vi.fn(),
  open: vi.fn(),
  require: vi.fn(),
}));

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: async () => ({ remoteConsoleService: consoles }),
}));

const SCOPE: RemoteConsoleScope = { kind: "workspace", id: "workspace" };
const SESSION_ID = "6f1c2a8e-4b7d-4c1e-9a3f-2d5e8b0c7a11";
const URL_OF_ROUTE = `${SYNTHETIC_ORIGIN}/agents/remote/console`;

interface RequestOptions {
  readonly origin?: string | null;
  readonly method?: string;
  readonly body?: BodyInit | null;
}

function consoleRequest(options: RequestOptions = {}): Request {
  const origin =
    options.origin === undefined ? SYNTHETIC_ORIGIN : options.origin;

  return new Request(URL_OF_ROUTE, {
    body: options.body ?? null,
    headers: origin === null ? {} : { Origin: origin },
    method: options.method ?? "POST",
  });
}

async function answer(
  request: Request,
  user: User | null = EMPLOYEE,
): Promise<{
  readonly status: number;
  readonly body: unknown;
  readonly headers: Headers;
}> {
  const response = await remoteConsoleAction({ request, scope: SCOPE, user });
  const text = await response.text();

  return {
    body: text === "" ? null : (JSON.parse(text) as unknown),
    headers: response.headers,
    status: response.status,
  };
}

// Node needs half duplex for a streamed body; the DOM type of RequestInit lacks it.
interface StreamingRequestInit extends RequestInit {
  readonly duplex: "half";
}

function streamingRequest(stream: ReadableStream<Uint8Array>): Request {
  const init: StreamingRequestInit = {
    body: stream,
    duplex: "half",
    headers: { Origin: SYNTHETIC_ORIGIN },
    method: "POST",
  };

  return new Request(URL_OF_ROUTE, init);
}

function streamOf(chunks: readonly string[]): {
  readonly stream: ReadableStream<Uint8Array>;
  readonly cancel: ReturnType<typeof vi.fn>;
} {
  const encoder = new TextEncoder();
  const cancel = vi.fn();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    cancel,
    pull(controller): void {
      const chunk = chunks[index];
      index += 1;
      if (chunk === undefined) controller.close();
      else controller.enqueue(encoder.encode(chunk));
    },
  });

  return { cancel, stream };
}

beforeEach(() => {
  vi.resetAllMocks();
});

it("opens a console with the size and the same-origin address", async () => {
  consoles.open.mockResolvedValue(SESSION_ID);

  const outcome = await answer(
    consoleRequest({
      body: JSON.stringify({ intent: "open", columns: 80, rows: 24 }),
    }),
  );

  expect(outcome.status).toBe(200);
  expect(outcome.body).toEqual({ sessionId: SESSION_ID });
  expect(outcome.headers.get("Cache-Control")).toBe("no-store");
  expect(outcome.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(consoles.open).toHaveBeenCalledWith(
    "employee",
    SCOPE,
    { intent: "open", columns: 80, rows: 24 },
    { origin: SYNTHETIC_ORIGIN },
  );
});

it("closes a console of the person", async () => {
  const outcome = await answer(
    consoleRequest({
      body: JSON.stringify({ intent: "close", sessionId: SESSION_ID }),
    }),
  );

  expect(outcome.body).toEqual({ ok: true });
  expect(consoles.close).toHaveBeenCalledWith("employee", SCOPE, SESSION_ID);
});

it("reconnects a console after checking ownership", async () => {
  const session = { reconnect: vi.fn() };
  consoles.require.mockResolvedValue(session);

  const outcome = await answer(
    consoleRequest({
      body: JSON.stringify({ intent: "reconnect", sessionId: SESSION_ID }),
    }),
  );

  expect(outcome.body).toEqual({ ok: true });
  expect(consoles.require).toHaveBeenCalledWith("employee", SCOPE, SESSION_ID);
  expect(session.reconnect).toHaveBeenCalledOnce();
});

it("reads a body that arrives in several chunks", async () => {
  const { stream } = streamOf([
    '{"intent":"close",',
    `"sessionId":"${SESSION_ID}"}`,
  ]);

  const outcome = await answer(streamingRequest(stream));

  expect(outcome.body).toEqual({ ok: true });
  expect(consoles.close).toHaveBeenCalledOnce();
});

it.each([
  ["without a person", consoleRequest(), null],
  ["without an origin", consoleRequest({ origin: null }), EMPLOYEE],
  [
    "from a foreign origin",
    consoleRequest({ origin: "https://evil.invalid" }),
    EMPLOYEE,
  ],
])(
  "refuses a request %s",
  async (caseName, request: Request, user: User | null) => {
    const outcome = await answer(request, user);

    expect(outcome.status).toBe(403);
    expect(outcome.body).toEqual({
      message: "remote.error.remote_access_denied",
    });
    expect(outcome.headers.get("Cache-Control")).toBe("no-store");
    expect(consoles.open).not.toHaveBeenCalled();
  },
);

it("allows only POST", async () => {
  const response = await remoteConsoleAction({
    request: consoleRequest({ method: "PUT", body: "{}" }),
    scope: SCOPE,
    user: EMPLOYEE,
  });

  expect(response.status).toBe(405);
  expect(response.headers.get("Allow")).toBe("POST");
  expect(await response.text()).toBe("");
});

it("refuses a POST without a body", async () => {
  const outcome = await answer(consoleRequest());

  expect(outcome.status).toBe(400);
  expect(outcome.body).toEqual({
    message: "remote.error.remote_workspace_invalid",
  });
});

it("stops reading and cancels an oversized body", async () => {
  const { cancel, stream } = streamOf(["x".repeat(4000), "y".repeat(200), "z"]);

  const outcome = await answer(streamingRequest(stream));

  expect(outcome.status).toBe(400);
  expect(outcome.body).toEqual({
    message: "remote.error.remote_workspace_invalid",
  });
  expect(cancel).toHaveBeenCalledOnce();
});

it.each([
  ["unreadable JSON", '{"intent":"open","password":"secret"'],
  ["an unknown intent", JSON.stringify({ intent: "resize" })],
  ["a malformed session", JSON.stringify({ intent: "close", sessionId: "s" })],
  [
    "an impossible size",
    JSON.stringify({ intent: "open", columns: 1, rows: 1 }),
  ],
])("answers %s with a general failure", async (caseName, body) => {
  const outcome = await answer(consoleRequest({ body }));

  expect(outcome.status).toBe(400);
  expect(outcome.body).toEqual({ message: "remote.failure.remote_failed" });
  expect(JSON.stringify(outcome.body)).not.toContain("secret");
  expect(consoles.open).not.toHaveBeenCalled();
  expect(consoles.close).not.toHaveBeenCalled();
});

it("answers a refusal of the console service with its status", async () => {
  consoles.require.mockRejectedValue(
    new RemoteError("remote_workspace_not_found"),
  );

  const outcome = await answer(
    consoleRequest({
      body: JSON.stringify({ intent: "reconnect", sessionId: SESSION_ID }),
    }),
  );

  expect(outcome.status).toBe(404);
  expect(outcome.body).toEqual({
    message: "remote.error.remote_workspace_not_found",
  });
});
