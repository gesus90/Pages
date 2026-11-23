import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

import { LocalOwnerHttp } from "@/backend/agents/local/LocalOwnerHttp";
import { localOwnerManifestSchema } from "@/backend/agents/local/LocalSessionContracts";
import { pagesTempDirectory } from "@/backend/config/PagesTempDirectory";

import type * as HttpModule from "node:http";
import type * as FsPromisesModule from "node:fs/promises";
import type {
  IncomingMessage,
  RequestListener,
  Server,
  ServerResponse,
} from "node:http";
import type { LocalOwnerSession } from "@/backend/agents/local/LocalOwnerSession";
import type { LocalSessionJournal } from "@/backend/agents/local/LocalSessionJournal";

const hoisted = vi.hoisted(() => ({
  log: vi.fn(),
  socket: "",
  handler: null as null | RequestListener,
  server: null as null | Server,
  lstat: null as null | ((file: string) => Promise<unknown>),
}));

vi.mock("@/backend/logging/Logger", () => ({ logEvent: hoisted.log }));
vi.mock("@/backend/agents/local/LocalSessionTransport", () => ({
  localSessionSocket: () => hoisted.socket,
}));
vi.mock("node:http", async (importOriginal) => {
  const actual = await importOriginal<typeof HttpModule>();
  return {
    ...actual,
    createServer: (handler: RequestListener) => {
      hoisted.handler = handler;
      hoisted.server = actual.createServer(handler);
      return hoisted.server;
    },
  };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromisesModule>();
  return {
    ...actual,
    lstat: (...args: Parameters<typeof actual.lstat>) =>
      hoisted.lstat ? hoisted.lstat(String(args[0])) : actual.lstat(...args),
  };
});

const UUID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "22222222-2222-4222-8222-222222222222";
const BEARER = "b".repeat(43);

const manifest = localOwnerManifestSchema.parse({
  version: 1,
  instanceKey: "a".repeat(64),
  capability: "c".repeat(64),
  configPath: "/config",
  directory: "/directory",
  unit: `pages-local-${UUID}.service`,
  launch: {
    runId: UUID,
    stepId: "step",
    sessionScopeId: "scope",
    attemptId: UUID,
    turnId: UUID,
    isInstruction: false,
    instanceId: UUID,
    userId: UUID,
    prompt: "p",
    instruction: "i",
    resumeSessionId: null,
    timeoutMinutes: 1,
    mcp: null,
  },
});

/** The owner session and journal are replaced by recording doubles. */
function double<Contract>(value: object): Contract {
  return value as unknown as Contract;
}

const session = {
  receiveBearer: vi.fn(),
  next: vi.fn(async () => undefined),
  steer: vi.fn(async () => "accepted"),
  cancel: vi.fn(async () => undefined),
  setPaused: vi.fn(async () => undefined),
  suspend: vi.fn(async () => true),
  resume: vi.fn(async () => false),
  interrupt: vi.fn(async () => true),
  close: vi.fn(async () => ({ isConfirmed: true })),
};
const journal = {
  page: vi.fn(async () => [{ sequence: 1 }]),
  acknowledge: vi.fn(async () => undefined),
};

const startDirectory = process.cwd();
let root = "";
let counter = 0;
const owners: LocalOwnerHttp[] = [];

beforeAll(async () => {
  const base = pagesTempDirectory("local-owner-http-test");
  await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, "c-"));
  // The private home of the test run makes absolute socket paths longer than
  // the Unix socket limit, so sockets are addressed relative to the folder.
  process.chdir(root);
});
afterAll(async () => {
  process.chdir(startDirectory);
  await rm(root, { recursive: true, force: true });
});
afterEach(async () => {
  hoisted.lstat = null;
  for (const owner of owners.splice(0)) await owner.close();
});

function createOwner(release = vi.fn(async () => undefined)): {
  readonly owner: LocalOwnerHttp;
  readonly release: typeof release;
} {
  counter += 1;
  hoisted.socket = `s${counter}.sock`;
  const owner = new LocalOwnerHttp(
    manifest,
    double<LocalOwnerSession>(session),
    double<LocalSessionJournal>(journal),
    release,
  );
  owners.push(owner);
  return { owner, release };
}

interface Reply {
  readonly status: number | undefined;
  readonly body: string;
}

function post(
  body: string,
  options: {
    readonly method?: string;
    readonly path?: string;
    readonly authorization?: string | null;
    readonly attachment?: string;
  } = {},
): Promise<Reply> {
  const socketPath = hoisted.socket;
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        socketPath,
        method: options.method ?? "POST",
        path: options.path ?? "/",
        headers: {
          ...(options.authorization === null
            ? {}
            : {
                authorization:
                  options.authorization ?? `Bearer ${manifest.capability}`,
              }),
          ...(options.attachment === undefined
            ? {}
            : { "x-pages-attachment": options.attachment }),
        },
      },
      (response) => {
        let received = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (received += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode, body: received }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

async function attach(): Promise<void> {
  const reply = await post(JSON.stringify({ kind: "attach", token: TOKEN }));
  expect(reply.status).toBe(200);
}

async function command(
  payload: object,
  attachment: string = TOKEN,
): Promise<Reply> {
  return post(JSON.stringify(payload), { attachment });
}

it("rejects requests that are not authenticated POSTs to the root", async () => {
  const { owner } = createOwner();
  await owner.listen();
  const body = JSON.stringify({ kind: "cancel" });
  expect((await post(body, { method: "GET" })).status).toBe(403);
  expect((await post(body, { path: "/other" })).status).toBe(403);
  expect((await post(body, { authorization: null })).status).toBe(403);
  expect((await post(body, { authorization: "Bearer short" })).status).toBe(
    403,
  );
  expect(
    (await post(body, { authorization: `Bearer ${"d".repeat(64)}` })).status,
  ).toBe(403);
  expect(session.cancel).not.toHaveBeenCalled();
});

it("executes every command of an attached client", async () => {
  const { owner } = createOwner();
  await owner.listen();
  await attach();
  const launch = manifest.launch;
  const cases: readonly (readonly [object, unknown])[] = [
    [{ kind: "bearer", token: BEARER }, { ok: true }],
    [{ kind: "read", after: 0, limit: 5 }, { records: [{ sequence: 1 }] }],
    [{ kind: "ack", sequence: 1, digest: "d" }, { ok: true }],
    [{ kind: "next", launch }, { ok: true }],
    [{ kind: "steer", prompt: "go", commandId: UUID }, { outcome: "accepted" }],
    [{ kind: "cancel" }, { ok: true }],
    [{ kind: "pause", isPaused: true }, { ok: true }],
    [{ kind: "suspend" }, { changed: true }],
    [{ kind: "resume" }, { changed: false }],
    [{ kind: "interrupt" }, { interrupted: true }],
    [{ kind: "close" }, { closed: { isConfirmed: true } }],
  ];
  for (const [payload, expected] of cases) {
    const reply = await command(payload);
    expect(reply.status).toBe(200);
    expect(JSON.parse(reply.body)).toEqual(expected);
  }
  expect(session.receiveBearer).toHaveBeenCalledWith(BEARER);
  expect(journal.page).toHaveBeenCalledWith(0, 5);
  expect(journal.acknowledge).toHaveBeenCalledWith(1, "d");
  expect(session.next).toHaveBeenCalledWith(launch);
  expect(session.steer).toHaveBeenCalledWith("go", UUID);
  expect(session.setPaused).toHaveBeenCalledWith(true);
});

it("rejects a command from a stale attachment", async () => {
  const { owner } = createOwner();
  await owner.listen();
  await attach();
  const reply = await command({ kind: "cancel" }, "old");
  expect(reply.status).toBe(409);
  expect(JSON.parse(reply.body)).toEqual({ error: "stale_attachment" });
  expect(hoisted.log).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { kind: "cancel", code: "stale_attachment" },
    }),
  );
});

it("rechecks the attachment once the queued command runs", async () => {
  const { owner } = createOwner();
  await owner.listen();
  await attach();
  let unblock: () => void = () => undefined;
  journal.page.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        unblock = () => resolve([]);
      }),
  );
  const first = command({ kind: "read", after: 0, limit: 1 });
  await vi.waitFor(() => expect(journal.page).toHaveBeenCalled());
  const replace = post(JSON.stringify({ kind: "attach", token: UUID }));
  await vi.waitFor(() => undefined, { timeout: 50 }).catch(() => undefined);
  const stale = command({ kind: "cancel" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  unblock();
  expect((await first).status).toBe(200);
  expect((await replace).status).toBe(200);
  const reply = await stale;
  expect(reply.status).toBe(409);
  expect(JSON.parse(reply.body)).toEqual({ error: "stale_attachment" });
});

it("hides the details of invalid and failing commands", async () => {
  const { owner } = createOwner();
  await owner.listen();
  await attach();
  for (const body of ["not json", JSON.stringify({ kind: "unknown" })]) {
    const reply = await post(body, { attachment: TOKEN });
    expect(reply.status).toBe(409);
    expect(JSON.parse(reply.body)).toEqual({ error: "internal" });
  }
  expect(hoisted.log).toHaveBeenCalledWith(
    expect.objectContaining({
      metadata: { kind: "invalid", code: "internal" },
    }),
  );
});

it("releases only after the owner confirmed its cleanup", async () => {
  const { owner, release } = createOwner();
  await owner.listen();
  await attach();
  session.close.mockResolvedValueOnce({ isConfirmed: false });
  const refused = await command({ kind: "release" });
  expect(refused.status).toBe(409);
  expect(JSON.parse(refused.body)).toEqual({
    error: "native_cleanup_unconfirmed",
  });
  expect(release).not.toHaveBeenCalled();

  const accepted = await command({ kind: "release" });
  expect(accepted.status).toBe(200);
  expect(JSON.parse(accepted.body)).toEqual({ closed: { isConfirmed: true } });
  await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
});

it("logs a failure after the answer was already sent", async () => {
  const { owner, release } = createOwner();
  await owner.listen();
  await attach();
  release.mockRejectedValueOnce(new Error("private"));
  const reply = await command({ kind: "release" });
  expect(reply.status).toBe(200);
  await vi.waitFor(() =>
    expect(hoisted.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { kind: "release", code: "internal" },
      }),
    ),
  );
});

it("fails to listen on an occupied socket and restores the umask", async () => {
  const { owner } = createOwner();
  await owner.listen();
  const first = hoisted.socket;
  const second = new LocalOwnerHttp(
    manifest,
    double<LocalOwnerSession>(session),
    double<LocalSessionJournal>(journal),
    async () => undefined,
  );
  hoisted.socket = first;
  const mask = process.umask();
  await expect(second.listen()).rejects.toThrow();
  expect(process.umask()).toBe(mask);
});

it("does nothing when closing a server that is not listening", async () => {
  const { owner } = createOwner();
  await expect(owner.close()).resolves.toBeUndefined();
});

it("keeps a replaced socket and removes an unchanged one", async () => {
  const { owner } = createOwner();
  await owner.listen();
  const stats = { ino: 1, uid: 1 };
  const lstat = vi.fn();
  hoisted.lstat = lstat;
  lstat.mockResolvedValueOnce(stats).mockResolvedValueOnce({ ino: 2, uid: 1 });
  await owner.close();
  expect(lstat).toHaveBeenCalledTimes(2);
});

it("unlinks a socket that is still the same file after closing", async () => {
  const { owner } = createOwner();
  await owner.listen();
  hoisted.lstat = async () => ({ ino: 1, uid: 1 });
  await expect(owner.close()).resolves.toBeUndefined();
});

it("keeps a socket of another owner when only the owner differs", async () => {
  const { owner } = createOwner();
  await owner.listen();
  const lstat = vi.fn();
  hoisted.lstat = lstat;
  lstat.mockResolvedValueOnce({ ino: 1, uid: 1 }).mockResolvedValueOnce({
    ino: 1,
    uid: 2,
  });
  await owner.close();
  expect(lstat).toHaveBeenCalledTimes(2);
});

it("rethrows unexpected failures while checking the socket", async () => {
  const { owner } = createOwner();
  await owner.listen();
  const lstat = vi.fn();
  hoisted.lstat = lstat;
  lstat
    .mockResolvedValueOnce({ ino: 1, uid: 1 })
    .mockRejectedValueOnce(new Error("denied"));
  await expect(owner.close()).rejects.toThrow("denied");

  const second = createOwner().owner;
  await second.listen();
  const again = vi.fn();
  hoisted.lstat = again;
  again
    .mockResolvedValueOnce({ ino: 1, uid: 1 })
    .mockRejectedValueOnce("not an error");
  await expect(second.close()).rejects.toBe("not an error");
});

it("rejects when the server cannot close", async () => {
  const { owner } = createOwner();
  await owner.listen();
  const server = hoisted.server;
  if (!server) throw new Error("The test server was not created");
  const spy = vi.spyOn(server, "close").mockImplementation((callback) => {
    callback?.(new Error("close failed"));
    return server;
  });
  await expect(owner.close()).rejects.toThrow("close failed");
  spy.mockRestore();
});

/** Minimal request double that yields the given chunks. */
function fakeRequest(chunks: readonly unknown[]): IncomingMessage {
  return double<IncomingMessage>({
    method: "POST",
    url: "/",
    headers: { authorization: `Bearer ${manifest.capability}` },
    setEncoding: () => undefined,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  });
}

async function receiveFake(chunks: readonly unknown[]): Promise<number[]> {
  createOwner();
  const statuses: number[] = [];
  const response = double<ServerResponse>({
    headersSent: false,
    writeHead: (status: number) => {
      statuses.push(status);
      return response;
    },
    end: () => undefined,
  });
  hoisted.handler?.(fakeRequest(chunks), response);
  await vi.waitFor(() => expect(statuses.length).toBeGreaterThan(0));
  return statuses;
}

it("rejects a request body that is not text", async () => {
  expect(await receiveFake([Buffer.from("{}")])).toEqual([409]);
});

it("rejects a request body above the limit", async () => {
  expect(await receiveFake(["x".repeat(1024 * 1024 + 1)])).toEqual([409]);
});

it("accepts a body delivered in several chunks", async () => {
  const statuses = await receiveFake(['{"kind":', '"cancel"}']);
  expect(statuses).toEqual([409]);
});
