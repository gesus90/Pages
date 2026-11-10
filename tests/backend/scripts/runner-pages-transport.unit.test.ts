import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  notifyJobCompletion,
  pagesFailure,
  pagesRequest,
  startPagesRelay,
} from "@/scripts/runner/pages.mjs";

import {
  FakeSocket,
  fakeNet,
  okReply,
  refusedReply,
} from "./runner-pages-net-fake";

vi.mock("node:net", async () =>
  (await import("./runner-pages-net-fake")).netModule(),
);

const JOB = "0b9f6a52-3f0c-4a55-9d8e-6a1a8f6c2d11";

let directory = "";

beforeEach(async () => {
  fakeNet.reset();
  directory = await mkdtemp(join(tmpdir(), "pages-relay-unit-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("pagesFailure", () => {
  it("keeps a stable preparation code and hides everything else", () => {
    expect(pagesFailure({ code: "plan_access_denied" })).toBe(
      "plan_access_denied",
    );
    expect(pagesFailure({ code: "EACCES" })).toBe("plan_mcp_unavailable");
    expect(pagesFailure(undefined)).toBe("plan_mcp_unavailable");
  });
});

describe("pagesRequest", () => {
  it("sends the job and request as one line and resolves the result", async () => {
    fakeNet.handler = () => okReply({ files: [] });
    const result = await pagesRequest("/run/pages.sock", JOB, {
      kind: "prepare",
    });
    expect(result).toEqual({ files: [] });
    expect(fakeNet.connectedPaths).toEqual(["/run/pages.sock"]);
    expect(fakeNet.clientSockets[0]?.written).toBe(
      JSON.stringify({ jobId: JOB, request: { kind: "prepare" } }) + "\n",
    );
    expect(fakeNet.clientSockets[0]?.timeoutMs).toBe(25000);
  });

  it("joins a reply that arrives in several chunks", async () => {
    fakeNet.handler = () => ['{"ok":true,', '"result":7}'];
    await expect(
      pagesRequest("/run/pages.sock", JOB, { kind: "list" }),
    ).resolves.toBe(7);
  });

  it("uses a short timeout for the expendable completion hint", async () => {
    fakeNet.handler = () => okReply(null);
    await pagesRequest("/run/pages.sock", JOB, { kind: "job-completed" });
    expect(fakeNet.clientSockets[0]?.timeoutMs).toBe(500);
  });

  it.each([
    {
      label: "a stable resource code",
      body: { code: "plan_context_changed" },
      code: "plan_context_changed",
    },
    {
      label: "a transport outage",
      body: { code: "pages_transport_unavailable" },
      code: "pages_transport_unavailable",
    },
    {
      label: "an unknown code",
      body: { code: "database_exploded" },
      code: "plan_mcp_unavailable",
    },
  ])("refuses with $label", async ({ body, code }) => {
    fakeNet.handler = () =>
      refusedReply({ ...body, assetFailure: { reason: "gone" } });
    await expect(
      pagesRequest("/run/pages.sock", JOB, { kind: "asset" }),
    ).rejects.toMatchObject({
      message: "Pages access refused",
      code,
      assetFailure: { reason: "gone" },
    });
  });

  it("refuses a reply that is no JSON", async () => {
    fakeNet.handler = () => ["not json"];
    await expect(
      pagesRequest("/run/pages.sock", JOB, { kind: "list" }),
    ).rejects.toThrow("Pages access refused");
  });

  it("reports an unreachable socket as unavailable", async () => {
    fakeNet.connectError = true;
    await expect(
      pagesRequest("/run/pages.sock", JOB, { kind: "list" }),
    ).rejects.toThrow("Pages access unavailable");
  });

  it("destroys the socket when the timeout fires", async () => {
    const pending = pagesRequest("/run/pages.sock", JOB, { kind: "list" });
    const socket = fakeNet.clientSockets[0];
    socket.onTimeout?.();
    await expect(pending).rejects.toThrow("Pages access unavailable");
    expect(socket.destroyed).toBe(true);
  });

  it("destroys the socket when the reply exceeds two mebibytes", async () => {
    fakeNet.handler = () => ["x".repeat(2 * 1024 * 1024 + 1)];
    await expect(
      pagesRequest("/run/pages.sock", JOB, { kind: "list" }),
    ).rejects.toThrow("Pages access unavailable");
    expect(fakeNet.clientSockets[0]?.destroyed).toBe(true);
  });
});

describe("notifyJobCompletion", () => {
  it("sends the completion hint to the socket of the directory", async () => {
    fakeNet.handler = () => okReply(null);
    await notifyJobCompletion("/run/pages", JOB);
    expect(fakeNet.connectedPaths).toEqual(["/run/pages/pages.sock"]);
    expect(JSON.parse(fakeNet.clientSockets[0]?.written ?? "{}")).toEqual({
      jobId: JOB,
      request: { kind: "job-completed" },
    });
  });

  it("swallows a stopped transport", async () => {
    fakeNet.connectError = true;
    await expect(
      notifyJobCompletion("/run/pages", JOB),
    ).resolves.toBeUndefined();
  });
});

async function connect(
  request: (jobId: string, body: unknown) => Promise<unknown>,
): Promise<{ stop: () => Promise<void>; socket: FakeSocket }> {
  const stop = await startPagesRelay(directory, request);
  const socket = new FakeSocket();
  fakeNet.servers[0]?.connectionListener(socket);
  return { stop, socket };
}

async function finish(socket: FakeSocket): Promise<unknown> {
  socket.emit("end");
  await vi.waitFor(() => expect(socket.ended).toBe(true));
  return JSON.parse(socket.written);
}

describe("startPagesRelay", () => {
  it("replaces a stale socket, restricts the new one and removes it on stop", async () => {
    const socketPath = join(directory, "pages.sock");
    await writeFile(socketPath, "stale");
    const stop = await startPagesRelay(directory, vi.fn());
    expect(fakeNet.servers[0]?.socketPath).toBe(socketPath);
    expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(socketPath, "utf8")).toBe("");
    await stop();
    expect(fakeNet.servers[0]?.closed).toBe(true);
    await expect(stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects when the server cannot listen", async () => {
    fakeNet.listenError = new Error("EADDRINUSE");
    await expect(startPagesRelay(directory, vi.fn())).rejects.toThrow(
      "EADDRINUSE",
    );
  });
});

describe("relay connections", () => {
  it("forwards a request of a valid job and answers with its result", async () => {
    const request = vi.fn(async () => ({ tools: [] }));
    const { socket } = await connect(request);
    expect(socket.timeoutMs).toBe(30000);
    socket.emit(
      "data",
      Buffer.from(JSON.stringify({ jobId: JOB, request: { kind: "list" } })),
    );
    expect(await finish(socket)).toEqual({ ok: true, result: { tools: [] } });
    expect(request).toHaveBeenCalledWith(JOB, { kind: "list" });
  });

  it("answers an invalid job id without calling Pages", async () => {
    const request = vi.fn();
    const { socket } = await connect(request);
    socket.emit(
      "data",
      Buffer.from(JSON.stringify({ jobId: "../escape", request: {} })),
    );
    expect(await finish(socket)).toEqual({
      ok: false,
      code: "plan_mcp_unavailable",
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("passes a transport outage and the asset failure through", async () => {
    const failure = Object.assign(new Error("down"), {
      code: "pages_transport_unavailable",
      assetFailure: { reason: "offline" },
    });
    const { socket } = await connect(() => Promise.reject(failure));
    socket.emit(
      "data",
      Buffer.from(JSON.stringify({ jobId: JOB, request: {} })),
    );
    expect(await finish(socket)).toEqual({
      ok: false,
      code: "pages_transport_unavailable",
      assetFailure: { reason: "offline" },
    });
  });

  it("maps another failure to a stable code", async () => {
    const failure = Object.assign(new Error("denied"), {
      code: "plan_access_denied",
    });
    const { socket } = await connect(() => Promise.reject(failure));
    socket.emit(
      "data",
      Buffer.from(JSON.stringify({ jobId: JOB, request: {} })),
    );
    expect(await finish(socket)).toMatchObject({
      ok: false,
      code: "plan_access_denied",
    });
  });

  it("destroys a connection that sends more than 64 KiB", async () => {
    const { socket } = await connect(vi.fn());
    socket.emit("data", Buffer.from("x".repeat(65537)));
    expect(socket.destroyed).toBe(true);
  });

  it("destroys a connection that times out or fails", async () => {
    const timedOut = await connect(vi.fn());
    timedOut.socket.onTimeout?.();
    expect(timedOut.socket.destroyed).toBe(true);

    const failed = new FakeSocket();
    failed.on("error", () => undefined);
    fakeNet.servers[0]?.connectionListener(failed);
    failed.emit("error", new Error("reset"));
    expect(failed.destroyed).toBe(true);
  });
});
