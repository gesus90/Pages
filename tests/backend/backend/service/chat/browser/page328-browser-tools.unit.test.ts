import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { AgentBrowserService } from "@/backend/service/chat/browser/AgentBrowserService";
import { PicaAdminService } from "@/backend/service/chat/admin/PicaAdminService";
import { createPicaTools } from "@/backend/service/chat/PicaTools";

import { administratorFixture } from "../../../auth/account-fixture";

import { browserWorld } from "./page328-browser-world";

import type {
  PicaBrowserSessionInit,
  PicaBrowserStorageState,
} from "@/backend/service/chat/browser/PicaBrowserSession";
import type { PicaOperatorBrowserDependencies } from "@/backend/service/chat/browser/PicaOperatorBrowser";

const boundary = vi.hoisted(() => ({
  start: vi.fn<(state?: PicaBrowserStorageState) => Promise<void>>(
    async () => undefined,
  ),
  close: vi.fn(async () => undefined),
}));

vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
vi.mock("@/backend/service/chat/PicaPlanTools", () => ({
  registerPicaPlanTools: vi.fn(),
}));
/** A text matcher whose result is typed, so the assertion stays type-safe. */
function containingText(text: string): unknown {
  return expect.stringContaining(text);
}

vi.mock("@/backend/service/chat/browser/PicaBrowserObservation", () => ({
  observePage: async () => ({ text: "UNTRUSTED_DATA", images: [] }),
}));
vi.mock(
  "@/backend/service/chat/browser/PicaBrowserNavigation",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    checkedAddress: async (origins: unknown, url: string) => url,
    navigate: async () => "Navigated",
  }),
);
vi.mock("@/backend/service/chat/browser/PicaBrowserSession", () => {
  class FakeSession {
    public readonly id = "11111111-1111-4111-8111-111111111111";
    public readonly userId: string;
    public readonly scope: string;
    public currentState = "running";
    private readonly init: PicaBrowserSessionInit;

    public constructor(init: PicaBrowserSessionInit) {
      this.init = init;
      this.userId = init.userId;
      this.scope = init.scope;
    }

    /** Records the state passed across the Playwright boundary. */
    public start(state?: PicaBrowserStorageState): Promise<void> {
      return boundary.start(state);
    }
    /** No real browser runs in this unit test. */
    public close(): Promise<void> {
      return boundary.close();
    }
    /** Applies the live pause. */
    public pause(): void {
      this.currentState = "paused";
    }
    /** Applies the live resume. */
    public resume(): void {
      this.currentState = "running";
    }
    /** Applies the live stop. */
    public async stop(): Promise<void> {
      this.currentState = "stopped";
      await this.close();
    }
    /** Stub for activity tracking at the browser boundary. */
    public touch(): void {
      return undefined;
    }
    /** Stub for page title reads. */
    public async refreshTitles(): Promise<void> {
      return undefined;
    }
    /** Stub for browser action recording. */
    public record(): void {
      return undefined;
    }
    /** Returns only public browser facts. */
    public view(): object {
      return {
        browserId: this.id,
        state: this.currentState,
        ownerName: this.init.ownerName,
        profile: this.init.profile,
      };
    }
  }
  return { PicaBrowserSession: FakeSession };
});

beforeEach(() => {
  vi.useFakeTimers();
  boundary.start.mockClear();
  boundary.close.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

/** Builds the real employee service and native catalog with browser/OS boundaries replaced. */
async function toolsWorld(): Promise<{
  readonly world: ReturnType<typeof browserWorld>;
  readonly service: AgentBrowserService;
  readonly registry: ReturnType<typeof createPicaTools>;
  readonly launch: ReturnType<
    typeof vi.fn<PicaOperatorBrowserDependencies["launch"]>
  >;
}> {
  const world = browserWorld();
  const launch = vi.fn<PicaOperatorBrowserDependencies["launch"]>();
  const service = new AgentBrowserService(world.sessions, {
    launch,
    origins: () => ({ pages: world.accounts.origins(), services: [] }),
  });
  await service.bind(world.context);
  const registry = createPicaTools({
    tools: { run: vi.fn(async () => ({ ok: true, result: null })) },
    sessions: { confirmationWord: async () => "DELETE" },
    authorize: world.context.authorize,
    agentBrowsers: service,
  });
  return { world, service, registry, launch };
}

it("lists the visual tools as user tools, with no administrator catalog or file-transfer tools", async () => {
  const { world, service, registry } = await toolsWorld();
  const catalog = registry.describe({ includeAdministrator: false });
  expect(catalog.map((tool) => tool.id)).toEqual(
    expect.arrayContaining([
      "browser_open",
      "browser_observe",
      "browser_click",
      "browser_type",
      "browser_close",
      "browser_profiles",
    ]),
  );
  expect(
    catalog
      .filter((tool) => tool.id.startsWith("browser_"))
      .every(
        (tool) =>
          tool.access === "user" && !tool.description.includes("ADMIN ONLY"),
      ),
  ).toBe(true);
  for (const tool of [
    "browser_downloads",
    "browser_upload",
    "browser_handover",
    "admin_browser_open",
    "list_admin_users",
  ])
    expect(catalog.map((entry) => entry.id)).not.toContain(tool);
  await service.release(world.context);
});

it("offers no browser at all without the server-owned employee capability", () => {
  const registry = createPicaTools({
    tools: { run: vi.fn() },
    sessions: { confirmationWord: async () => "DELETE" },
    authorize: async () => undefined,
  });
  expect(
    registry.describe().some((tool) => tool.id.startsWith("browser_")),
  ).toBe(false);
});

it("opens the own-account profile by default and explicitly as self, keeping state out of the response", async () => {
  const { world, service, registry, launch } = await toolsWorld();
  const lease = await world.sessions.issue(world.context);
  const reply = await registry.invoke(
    "browser_open",
    {
      task: "Review Pages",
      profile: "self",
      url: "http://127.0.0.1:3000/settings",
    },
    world.context,
  );
  expect(reply).toMatchObject({ isValid: true, output: { ok: true } });
  expect(boundary.start).toHaveBeenCalledWith(lease.storage);
  expect(launch).toHaveBeenCalledOnce();
  expect(JSON.stringify(reply)).not.toContain(lease.storage.cookies[0].value);
  expect(await service.overview()).toMatchObject({
    browsers: [{ ownerName: "Bakuman", profile: "self" }],
  });
  await service.release(world.context);
  expect(boundary.close).toHaveBeenCalled();
});

it("rejects a guessed foreign/admin profile before launching and lists only self", async () => {
  const { world, service, registry, launch } = await toolsWorld();
  const result = await registry.invoke(
    "browser_open",
    { task: "Review", profile: "admin" },
    world.context,
  );
  expect(result).toMatchObject({
    output: { ok: false, error: "SESSION_DENIED" },
  });
  expect(launch).not.toHaveBeenCalled();
  const profiles = await registry.invoke("browser_profiles", {}, world.context);
  expect(profiles).toMatchObject({
    output: { ok: true, result: containingText('"name":"self"') },
  });
  await service.release(world.context);
});

it("refuses foreign scopes, withdrawn access and direct calls to forbidden tools", async () => {
  const { world, service } = await toolsWorld();
  await expect(
    service.run(
      "browser_open",
      { task: "Review" },
      { ...world.context, userId: "other" },
    ),
  ).rejects.toThrow("SESSION_DENIED");
  expect(
    await service.run("browser_downloads", {}, world.context),
  ).toMatchObject({ ok: false, error: "SESSION_DENIED" });
  world.accounts.employee.mockResolvedValue({
    access: "read_only",
    revision: 2,
  });
  await expect(
    service.run("browser_open", { task: "Review" }, world.context),
  ).rejects.toThrow("SESSION_DENIED");
  await service.release(world.context);
});

it("exposes a private mount and usage instruction without putting the credential into either", async () => {
  const { world, service } = await toolsWorld();
  const lease = await world.sessions.issue(world.context);
  expect(service.mount(world.context)).toBe(
    lease.file.replace(/\/[^/]+$/u, ""),
  );
  expect(service.usage(world.context)).toContain(lease.file);
  expect(service.usage(world.context)).not.toContain(
    lease.storage.cookies[0].value,
  );
  await service.release(world.context);
});

it("shows agent browsers to a current administrator and permits pause/resume/stop with revocation", async () => {
  const { world, service, registry } = await toolsWorld();
  const admin = new PicaAdminService(
    {
      users: {
        getById: async () => ({ ...world.user, id: "admin", isAgent: false }),
      },
      administration: { getContext: async () => administratorFixture() },
    },
    { agentBrowsers: service },
  );
  await registry.invoke("browser_open", { task: "Review" }, world.context);
  const overview = await admin.browserOverview("admin");
  expect(overview.browsers).toHaveLength(1);
  const id = overview.browsers[0].browserId;
  expect(
    await admin.browserCommand("admin", id, { command: "pause" }),
  ).toMatchObject({ state: "paused" });
  expect(
    await admin.browserCommand("admin", id, { command: "resume" }),
  ).toMatchObject({ state: "running" });
  await expect(
    admin.browserCommand("admin", id, {
      command: "saveSession",
      name: "admin",
    }),
  ).rejects.toThrow("SESSION_DENIED");
  expect(
    await admin.browserCommand("admin", id, { command: "stop" }),
  ).toMatchObject({ state: "stopped" });
  expect((await service.overview()).browsers).toEqual([]);
  await expect(
    service.run("browser_open", { task: "Restart" }, world.context),
  ).rejects.toThrow("SESSION_DENIED");
});

it("withdraws live access after an account change even when no tool call arrives", async () => {
  const { world, service } = await toolsWorld();
  world.accounts.user.mockResolvedValue({ ...world.user, isActive: false });
  await vi.advanceTimersByTimeAsync(250);
  expect(() => service.mount(world.context)).toThrow("SESSION_DENIED");
});

vi.mock(
  "node:fs/promises",
  async () => (await import("./page328-browser-files")).runtimeFiles,
);
