import { EventEmitter } from "node:events";

import { vi } from "vitest";

import { proxies } from "./pica-browser-session-proxy";
import { PicaBrowserSession } from "@/backend/service/chat/browser/PicaBrowserSession";

import type { Mock } from "vitest";
import type { PicaBrowserStorageState } from "@/backend/service/chat/browser/PicaBrowserSession";
import type {
  PicaBrowserCapturedFile,
  PicaBrowserProxyHost,
} from "@/backend/service/chat/browser/PicaBrowserProxy";
import type { PicaBrowserOrigins } from "@/backend/service/chat/browser/PicaBrowserTargets";
import type { PicaBrowserSessionInit } from "@/backend/service/chat/browser/PicaBrowserSession";

type PicaBrowser = PicaBrowserSessionInit["browser"];

/** What a session passes when it opens a browser context. */
export type PicaContextOptions = NonNullable<
  Parameters<PicaBrowser["newContext"]>[0]
>;

/** A page dialog the tests answer through its two mocks. */
export interface FakeDialog {
  readonly type: () => string;
  readonly message: () => string;
  readonly accept: Mock<() => Promise<void>>;
  readonly dismiss: Mock<() => Promise<void>>;
}

/** The origins every fake session may reach. */
export const PAGES_ORIGINS: PicaBrowserOrigins = {
  pages: ["https://pages.test"],
  services: [],
};

/** A browser tab that records calls and emits the events Playwright would. */
export class FakePage extends EventEmitter {
  public address = "about:blank";
  public readonly frame = {};
  public readonly title = vi.fn(async () => "Title");
  public readonly setViewportSize = vi.fn(async () => undefined);
  public readonly close = vi.fn(async () => {
    this.emit("close");
  });

  /**
   *
   */
  public url(): string {
    return this.address;
  }

  /**
   *
   */
  public mainFrame(): object {
    return this.frame;
  }
}

/** A browser context that records calls; `popup` opens a tab the way a page script would. */
export class FakeContext extends EventEmitter {
  public options: PicaContextOptions = {};
  public readonly pages: FakePage[] = [];
  public readonly setDefaultTimeout = vi.fn();
  public readonly setDefaultNavigationTimeout = vi.fn();
  public readonly routeWebSocket = vi.fn(async () => undefined);
  public readonly route = vi.fn(async () => undefined);
  public readonly storageState = vi.fn(
    async (): Promise<PicaBrowserStorageState> => ({
      cookies: [],
      origins: [],
    }),
  );

  public readonly close = vi.fn(async () => undefined);

  public readonly newPage = vi.fn(async () => {
    const page = new FakePage();
    this.pages.push(page);
    this.emit("page", page);
    return page;
  });

  /**
   *
   */
  public popup(): FakePage {
    const page = new FakePage();
    this.pages.push(page);
    this.emit("page", page);
    return page;
  }
}

export interface World {
  readonly session: PicaBrowserSession;
  readonly browser: {
    newContext: Mock<(options: PicaContextOptions) => Promise<FakeContext>>;
    close: Mock<() => Promise<void>>;
  };
  readonly contexts: FakeContext[];
  readonly job: AbortController;
  readonly authorize: Mock<() => Promise<void>>;
}

/** Builds a session around a fake browser and remembers every context it opens. */
export function createWorld(
  overrides: Partial<PicaBrowserSessionInit> = {},
): World {
  const contexts: FakeContext[] = [];
  const browser = {
    newContext: vi.fn(async (options: PicaContextOptions) => {
      const context = new FakeContext();
      context.options = options;
      contexts.push(context);
      return context;
    }),
    close: vi.fn(async () => undefined),
  };
  const job = new AbortController();
  const authorize = vi.fn(async () => undefined);
  const session = new PicaBrowserSession({
    userId: "user-1",
    scope: "scope-1",
    conversationId: "conversation-1",
    task: "Check the dashboard",
    profile: null,
    device: "desktop",
    browser: browser as unknown as PicaBrowser,
    origins: () => PAGES_ORIGINS,
    authorize,
    signal: job.signal,
    ...overrides,
  });
  return { session, browser, contexts, job, authorize };
}

/** Builds a session and starts it, returning its first context and tab. */
export async function startWorld(
  overrides: Partial<PicaBrowserSessionInit> = {},
): Promise<World & { context: FakeContext; page: FakePage }> {
  const world = createWorld(overrides);
  await world.session.start();
  const context = world.contexts[0];
  return { ...world, context, page: context.pages[0] };
}

/** A page dialog of the given kind whose answer calls resolve or fail. */
export function fakeDialog(
  type: string,
  message: string,
  failure?: Error,
): FakeDialog {
  const settle = async (): Promise<void> => {
    if (failure) throw failure;
  };
  return {
    type: () => type,
    message: () => message,
    accept: vi.fn(settle),
    dismiss: vi.fn(settle),
  };
}

/** The callbacks the session gave the replaced proxy. */
export function proxyHost(index = 0): PicaBrowserProxyHost {
  return proxies.hosts[index] as PicaBrowserProxyHost;
}

/** A downloaded file of the given size. */
export function file(name: string, size: number): PicaBrowserCapturedFile {
  return {
    fileName: name,
    contentType: "application/pdf",
    bytes: Buffer.alloc(size),
    url: `https://pages.test/${name}`,
  };
}
