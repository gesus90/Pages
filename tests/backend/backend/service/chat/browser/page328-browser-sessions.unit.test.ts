import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { readSessionToken } from "@/app/lib/session.server";
import { AgentBrowserRuntimeFiles } from "@/backend/service/chat/browser/AgentBrowserRuntimeFiles";
import { adminScope } from "@/backend/service/chat/admin/PicaAdminFiles";

import { deferred } from "../../agents/page81-resource-fixture";
import { SessionWorld } from "../../../auth/session-service-world";

import { browserWorld, runtimeFiles } from "./page328-browser-world";

import type { AgentBrowserLease } from "@/backend/service/chat/browser/AgentBrowserSessions";

/** Reads exactly the cookie header a Playwright context would send to Pages. */
async function tokenOf(lease: AgentBrowserLease): Promise<string> {
  const cookie = lease.storage.cookies[0];
  const token = await readSessionToken(`${cookie.name}=${cookie.value}`);
  if (!token) throw new Error("Missing browser token");
  return token;
}

beforeEach(() => {
  vi.useFakeTimers();
  runtimeFiles.contents.clear();
  runtimeFiles.writeFile.mockClear();
  runtimeFiles.rm.mockClear();
});
afterEach(() => vi.useRealTimers());

it.each(["workspace", "yolo"] as const)(
  "authenticates %s as the agent with the cookie from its storageState",
  async (access) => {
    const world = browserWorld(access);
    const lease = await world.sessions.issue(world.context);
    const sessionWorld = new SessionWorld();
    sessionWorld.sessions.setAgentBrowsers(world.sessions);
    const token = await tokenOf(lease);

    expect(await sessionWorld.sessions.authenticate(token)).toEqual(world.user);
    expect(await world.sessions.issue(world.context)).toBe(lease);
    expect(lease.storage.origins).toEqual([]);
    expect(lease.storage.cookies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "127.0.0.1",
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        }),
        expect.objectContaining({
          domain: "pages.example.org",
          httpOnly: true,
          secure: true,
        }),
      ]),
    );
    expect(
      lease.storage.cookies[0].expires * 1000 - Date.now(),
    ).toBeLessThanOrEqual(8 * 60 * 60_000);
    const write = runtimeFiles.writeFile.mock.calls[0];
    expect(write[0]).toBe(lease.file);
    expect(JSON.parse(write[1])).toEqual(lease.storage);
    expect(runtimeFiles.writeFile).toHaveBeenCalledWith(
      lease.file,
      JSON.stringify(lease.storage),
      { mode: 0o600, flag: "wx" },
    );
    expect(lease.file.startsWith("/chat-1/")).toBe(false);
    expect(lease.file).not.toContain("/Agents/");
    await world.sessions.close();
  },
);

it("gives Nur Pages no session or file", async () => {
  const world = browserWorld("read_only");
  await expect(world.sessions.issue(world.context)).rejects.toThrow(
    "SESSION_DENIED",
  );
  expect(runtimeFiles.writeFile).not.toHaveBeenCalled();
});

it.each([
  { isActive: false },
  { isAgent: false },
  { mustChangePassword: true },
  { role: "admin" as const },
])("refuses an ineligible account at issuance: %j", async (change) => {
  const world = browserWorld();
  world.accounts.user.mockResolvedValue({ ...world.user, ...change });
  await expect(world.sessions.issue(world.context)).rejects.toThrow(
    "SESSION_DENIED",
  );
  expect(runtimeFiles.writeFile).not.toHaveBeenCalled();
});

it("removes state and invalidates the cookie at job completion, including replay through SessionService", async () => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  const token = await tokenOf(lease);
  const auth = new SessionWorld();
  auth.sessions.setAgentBrowsers(world.sessions);
  expect(runtimeFiles.contents.has(lease.file)).toBe(true);
  await world.sessions.release(adminScope(world.context));
  expect(runtimeFiles.contents.has(lease.file)).toBe(false);
  expect(await auth.sessions.authenticate(token)).toBeNull();
  expect(lease.context.signal.aborted).toBe(true);
  await world.sessions.release(adminScope(world.context));
});

it.each([
  "disabled",
  "downgraded",
  "changed",
  "missing",
  "ended",
  "expired",
] as const)("revokes immediately when %s", async (reason) => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  const token = await tokenOf(lease);
  if (reason === "disabled")
    world.accounts.user.mockResolvedValue({ ...world.user, isActive: false });
  if (reason === "downgraded")
    world.accounts.employee.mockResolvedValue({
      access: "read_only",
      revision: 2,
    });
  if (reason === "changed")
    world.accounts.employee.mockResolvedValue({
      access: "workspace",
      revision: 2,
    });
  if (reason === "missing") world.accounts.employee.mockResolvedValue(null);
  if (reason === "ended") world.controller.abort();
  if (reason === "expired") await vi.advanceTimersByTimeAsync(8 * 60 * 60_000);
  expect(await world.sessions.authenticate(token)).toBeNull();
  expect(runtimeFiles.contents.has(lease.file)).toBe(false);
  expect(lease.context.signal.aborted).toBe(true);
});

it("fails closed and cleans up when reauthorization fails", async () => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  vi.mocked(world.context.authorize).mockRejectedValue(new Error("revoked"));
  expect(await world.sessions.authenticate(await tokenOf(lease))).toBeNull();
  expect(runtimeFiles.contents.has(lease.file)).toBe(false);
});

it("does not authenticate unknown issued tokens or upgrade a human login into an agent login", async () => {
  const world = browserWorld();
  const auth = new SessionWorld();
  expect(await world.sessions.authenticate("pabs_unknown")).toBeNull();
  expect(await auth.sessions.authenticate("pabs_unknown")).toBeNull();
});

it("revokes an issued session through normal logout", async () => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  const auth = new SessionWorld();
  auth.sessions.setAgentBrowsers(world.sessions);
  await auth.sessions.revoke(await tokenOf(lease));
  expect(runtimeFiles.contents.has(lease.file)).toBe(false);
  expect(await world.sessions.authenticate(await tokenOf(lease))).toBeNull();
});

it("does not revoke another concurrent job or use another conversation's mount", async () => {
  const world = browserWorld();
  const first = await world.sessions.issue(world.context);
  const second = await world.sessions.issue({
    ...world.context,
    sessionId: "chat-2",
    runId: "job-2",
  });
  expect(path.dirname(first.file)).not.toBe(path.dirname(second.file));
  await world.sessions.release(adminScope(world.context));
  expect(await world.sessions.authenticate(await tokenOf(second))).toEqual(
    world.user,
  );
  await world.sessions.close();
});

it("keeps an empty conversation mount for pooled sessions but renews the token each job", async () => {
  const world = browserWorld();
  const first = await world.sessions.issue(world.context);
  await world.sessions.release(adminScope(world.context));
  const second = await world.sessions.issue({
    ...world.context,
    runId: "job-2",
  });
  expect(first.file).toBe(second.file);
  expect(await tokenOf(first)).not.toBe(await tokenOf(second));
  expect(await world.sessions.authenticate(await tokenOf(first))).toBeNull();
  await world.sessions.close();
});

it("does not issue a usable token when private file creation fails", async () => {
  const world = browserWorld();
  runtimeFiles.writeFile.mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(world.sessions.issue(world.context)).rejects.toThrow(
    "disk unavailable",
  );
  expect(runtimeFiles.contents.size).toBe(0);
  await world.sessions.close();
});

it("creates its parent with permissions 0700 and removes it on shutdown", async () => {
  const files = new AgentBrowserRuntimeFiles();
  const file = await files.write("conversation", { cookies: [], origins: [] });
  expect(runtimeFiles.mkdir).toHaveBeenCalledWith(path.dirname(file), {
    recursive: true,
    mode: 0o700,
  });
  await files.remove(file);
  await files.close();
  expect(runtimeFiles.rm).toHaveBeenCalledWith(
    "/runtime/pages-agent-browser-unit",
    { recursive: true, force: true },
  );
});

vi.mock(
  "node:fs/promises",
  async () => (await import("./page328-browser-files")).runtimeFiles,
);

it("waits for deletion already started by an abort before declaring the job released", async () => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  const deletion = deferred<void>();
  runtimeFiles.rm.mockImplementationOnce(async (file) => {
    await deletion.promise;
    runtimeFiles.contents.delete(file);
  });
  world.controller.abort();
  let isReleased = false;
  const release = world.sessions.release(adminScope(world.context)).then(() => {
    isReleased = true;
  });
  await Promise.resolve();
  expect(isReleased).toBe(false);
  deletion.resolve(undefined);
  await release;
  expect(runtimeFiles.contents.has(lease.file)).toBe(false);
  await world.sessions.close();
});

it("refuses a request revoked while its account lookup was still in flight", async () => {
  const world = browserWorld();
  const lease = await world.sessions.issue(world.context);
  const lookup = deferred<typeof world.user | null>();
  world.accounts.user.mockImplementationOnce(() => lookup.promise);
  const token = await tokenOf(lease);
  const authenticating = world.sessions.authenticate(token);
  await world.sessions.revoke(token);
  lookup.resolve(world.user);
  expect(await authenticating).toBeNull();
  await world.sessions.close();
});
