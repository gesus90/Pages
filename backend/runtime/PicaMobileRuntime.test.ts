import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigFile } from "@/backend/config/ConfigFile";
import { DEFAULT_CONFIG } from "@/backend/config/PagesConfig";
import { PAGES_VERSION } from "@/definition/Version";

import { PagesRuntime } from "./PagesRuntime";
import {
  createMobileConversations,
  obtainPicaMobileGateway,
  startPicaMobile,
} from "./PicaMobileRuntime";

import type {
  PagesConfig,
  PendingSetupConfig,
} from "@/backend/config/PagesConfig";

const mocks = vi.hoisted(() => {
  const constructed: Record<string, unknown[]> = {};
  const record = (name: string, options: unknown): void => {
    constructed[name] ??= [];
    constructed[name].push(options);
  };
  return {
    constructed,
    record,
    getApplicationServices: vi.fn(),
    logDiagnostic: vi.fn(),
    registerShutdownTask: vi.fn(),
    gatewayClose: vi.fn(),
    gatewaySwitchTo: vi.fn(),
    stopObserving: vi.fn(),
    addObserver: vi.fn(),
    conversationEvents: { name: "conversation-events" },
  };
});

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: mocks.getApplicationServices,
}));
vi.mock("@/backend/logging/Logger", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  logDiagnostic: mocks.logDiagnostic,
}));
vi.mock("@/backend/service/conversation/ConversationEvents", () => ({
  sharedConversationEvents: () => mocks.conversationEvents,
}));
vi.mock("@/backend/service/agents/AgentPlanRunObservers", () => ({
  sharedAgentPlanRunObservers: () => ({ add: mocks.addObserver }),
}));
vi.mock("./ProcessLifecycle", () => ({
  registerShutdownTask: mocks.registerShutdownTask,
}));
vi.mock("@/backend/service/mobile/PicaMobileAuthenticator", () => ({
  PagesPicaMobileAuthenticator: class {
    public constructor(resolver: unknown) {
      mocks.record("authenticator", resolver);
    }
  },
}));
vi.mock("@/backend/service/mobile/PicaMobileDashboardService", () => ({
  PagesPicaMobileDashboard: class {
    public constructor(resolver: unknown) {
      mocks.record("dashboard", resolver);
    }
  },
}));
vi.mock("@/backend/service/mobile/PicaMobileRelay", () => ({
  PicaMobileRelay: class {
    public readonly port: number;
    public constructor(options: { port: number }) {
      mocks.record("relay", options);
      this.port = options.port;
    }
  },
}));
vi.mock("@/backend/service/mobile/calendar/PagesPicaMobileCalendar", () => ({
  PagesPicaMobileCalendar: class {
    public constructor(resolver: unknown) {
      mocks.record("calendar", resolver);
    }
  },
}));
vi.mock("@/backend/service/mobile/chat/PagesPicaMobileChat", () => ({
  PagesPicaMobileChat: class {
    public constructor(resolver: unknown) {
      mocks.record("chat", resolver);
    }
  },
}));
vi.mock(
  "@/backend/service/mobile/conversations/PagesPicaMobileConversations",
  () => ({
    PagesPicaMobileConversations: class {
      public constructor(options: unknown) {
        mocks.record("conversations", options);
      }
    },
  }),
);
vi.mock(
  "@/backend/service/mobile/notifications/PagesPicaMobileNotifications",
  () => ({
    PagesPicaMobileNotifications: class {
      public constructor(resolver: unknown) {
        mocks.record("notifications", resolver);
      }
    },
  }),
);
vi.mock("@/backend/service/mobile/plans/PagesPicaMobilePlans", () => ({
  PagesPicaMobilePlans: class {
    public constructor(options: unknown) {
      mocks.record("plans", options);
    }
  },
}));
vi.mock("@/backend/service/mobile/speech/PagesPicaMobileSpeech", () => ({
  PagesPicaMobileSpeech: class {
    public constructor(resolver: unknown) {
      mocks.record("speech", resolver);
    }
  },
}));
vi.mock("@/backend/service/mobile/plans/PagesPicaMobilePlanControl", () => ({
  PagesPicaMobilePlanControl: class {
    public constructor(resolver: unknown) {
      mocks.record("control", resolver);
    }
  },
}));
vi.mock("@/backend/service/mobile/plans/PicaMobilePlanRunObserver", () => ({
  PicaMobilePlanRunObserver: class {
    public constructor() {
      mocks.record("observer", null);
    }
  },
}));
vi.mock("@/backend/service/mobile/PicaMobileGateway", () => ({
  PicaMobileGateway: class {
    public readonly relay: unknown;
    public readonly close = mocks.gatewayClose;
    public readonly switchTo = mocks.gatewaySwitchTo;
    public constructor(options: { relay?: unknown }) {
      mocks.record("gateway", options);
      this.relay = options.relay;
    }
  },
}));

class StubRuntime extends PagesRuntime {
  private readonly stubConfig: PagesConfig;

  public constructor(config: PagesConfig) {
    super(new ConfigFile("/etc/pages/config.toml"), DEFAULT_CONFIG);
    this.stubConfig = config;
  }

  /** Returns the configuration this test runtime was built with. */
  public override getConfig(): PagesConfig {
    return this.stubConfig;
  }
}

const SERVICES = {
  authService: "auth",
  calendarService: "calendar-service",
  liveChangeAudience: "audience",
  pagesEventPublisher: "publisher",
  conversationReader: "reader",
  conversationService: "conversation-service",
  agentPlanActiveRunService: "active-runs",
  projectService: "projects",
  userService: "users",
  sessionService: "sessions",
  picaMobileNotifications: "notifications",
  agentPlanOverviewService: "overview",
  agentPlanService: "plan-service",
  agentPlanCommands: "plan-commands",
  chatSessionService: "chat-sessions",
  chatService: "chat",
  picaAcpService: "acp",
  chatAttachmentService: "chat-attachments",
  picaAdminService: "admin",
  conversationAttachments: "conversation-attachments",
  speechRecognitionService: "speech",
};

function createConfig(
  overrides: Partial<PendingSetupConfig> = {},
): PendingSetupConfig {
  return { ...DEFAULT_CONFIG, listenAddress: "10.0.0.5", ...overrides };
}

function firstConstructed(name: string): unknown {
  return mocks.constructed[name]?.[0];
}

function isResolver(value: unknown): value is () => Promise<unknown> {
  return typeof value === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function fieldOf(source: unknown, key: string): unknown {
  return isRecord(source) ? source[key] : null;
}

async function resolveWith(
  source: unknown,
  key: string | null,
): Promise<unknown> {
  const candidate = key === null ? source : fieldOf(source, key);
  if (!isResolver(candidate)) throw new Error(`No resolver at ${String(key)}`);
  return candidate();
}

function gatewayOptions(): Record<string, unknown> {
  const options = firstConstructed("gateway");
  if (!isRecord(options)) throw new Error("The gateway was not created");
  return options;
}

beforeEach(() => {
  for (const name of Object.keys(mocks.constructed)) {
    delete mocks.constructed[name];
  }
  globalThis.pagesPicaMobileGateway = undefined;
  mocks.getApplicationServices.mockResolvedValue(SERVICES);
  mocks.addObserver.mockReturnValue(mocks.stopObserving);
  mocks.gatewayClose.mockResolvedValue(undefined);
  mocks.gatewaySwitchTo.mockResolvedValue(undefined);
});

describe("obtainPicaMobileGateway", () => {
  it("creates the gateway once with version, listen address and reserved port", () => {
    const runtime = new StubRuntime(createConfig());

    const gateway = obtainPicaMobileGateway(runtime, 3000);
    const again = obtainPicaMobileGateway(runtime, 4000);

    expect(again).toBe(gateway);
    expect(globalThis.pagesPicaMobileGateway).toBe(gateway);
    expect(mocks.constructed.gateway).toHaveLength(1);
    expect(gatewayOptions()).toMatchObject({
      serverVersion: PAGES_VERSION,
      listenAddress: "10.0.0.5",
      reservedPort: 3000,
      relay: undefined,
    });
    expect(mocks.registerShutdownTask).toHaveBeenCalledTimes(1);
  });

  it("leaves the reserved port open when the web port is not known", () => {
    obtainPicaMobileGateway(new StubRuntime(createConfig()));

    expect(gatewayOptions().reservedPort).toBeUndefined();
  });

  it("creates the relay only when the secret and the relay port are both stored", () => {
    obtainPicaMobileGateway(
      new StubRuntime(
        createConfig({ pagesCoreSecret: "s3cret", picaMobileRelayPort: 4711 }),
      ),
    );

    expect(firstConstructed("relay")).toEqual({
      secret: "s3cret",
      port: 4711,
    });
    expect(gatewayOptions().relay).toBeDefined();
  });

  it.each([
    ["only the secret", { pagesCoreSecret: "s3cret" }],
    ["only the port", { picaMobileRelayPort: 4711 }],
    ["neither", {}],
  ])("creates no relay with %s", (name, overrides) => {
    obtainPicaMobileGateway(new StubRuntime(createConfig(overrides)));

    expect(mocks.constructed.relay).toBeUndefined();
    expect(gatewayOptions().relay).toBeUndefined();
  });

  it("resolves the services lazily for every endpoint of the gateway", async () => {
    obtainPicaMobileGateway(new StubRuntime(createConfig()));
    const options = gatewayOptions();
    expect(mocks.getApplicationServices).not.toHaveBeenCalled();

    await expect(
      resolveWith(firstConstructed("authenticator"), null),
    ).resolves.toBe("auth");
    await expect(
      resolveWith(firstConstructed("dashboard"), null),
    ).resolves.toEqual({
      authService: "auth",
      agentPlanActiveRunService: "active-runs",
      projectService: "projects",
      userService: "users",
    });
    await expect(
      resolveWith(firstConstructed("notifications"), null),
    ).resolves.toEqual({
      authService: "auth",
      sessionService: "sessions",
      picaMobileNotifications: "notifications",
    });
    await expect(resolveWith(firstConstructed("chat"), null)).resolves.toEqual({
      authService: "auth",
      chatSessionService: "chat-sessions",
      chatService: "chat",
      picaAcpService: "acp",
      chatAttachmentService: "chat-attachments",
      picaAdminService: "admin",
    });
    await expect(resolveWith(options.attachments, null)).resolves.toEqual({
      authService: "auth",
      conversationAttachments: "conversation-attachments",
    });
    await expect(
      resolveWith(firstConstructed("speech"), null),
    ).resolves.toEqual({
      authService: "auth",
      speechRecognitionService: "speech",
    });
    await expect(
      resolveWith(firstConstructed("calendar"), null),
    ).resolves.toEqual({
      authService: "auth",
      calendarService: "calendar-service",
      liveChangeAudience: "audience",
      pagesEventPublisher: "publisher",
    });
  });
});

describe("obtainPicaMobileGateway endpoints", () => {
  it("gives the plans endpoint its services and the plan run observer", async () => {
    obtainPicaMobileGateway(new StubRuntime(createConfig()));
    const plans = firstConstructed("plans");

    await expect(resolveWith(plans, "resolveServices")).resolves.toEqual({
      authService: "auth",
      agentPlanOverviewService: "overview",
    });
    expect(mocks.addObserver).toHaveBeenCalledTimes(1);
    expect(mocks.addObserver).toHaveBeenCalledWith(
      isRecord(plans) ? plans.observer : null,
    );
  });

  it("gives the plan control its services on demand", async () => {
    obtainPicaMobileGateway(new StubRuntime(createConfig()));

    await expect(
      resolveWith(firstConstructed("control"), null),
    ).resolves.toEqual({
      authService: "auth",
      agentPlanOverviewService: "overview",
      agentPlanService: "plan-service",
      agentPlanCommands: "plan-commands",
    });
  });

  it("uses the conversations endpoint of the shared conversation events", () => {
    obtainPicaMobileGateway(new StubRuntime(createConfig()));

    expect(gatewayOptions().conversations).toBeDefined();
    expect(firstConstructed("conversations")).toMatchObject({
      events: mocks.conversationEvents,
    });
  });

  it("registers a shutdown task that stops observing and closes the gateway", async () => {
    obtainPicaMobileGateway(new StubRuntime(createConfig()));
    const [task, options] = mocks.registerShutdownTask.mock.calls[0] as [
      () => Promise<void>,
      { step: string },
    ];

    await task();

    expect(options).toEqual({ step: "pica_mobile_gateway" });
    expect(mocks.stopObserving).toHaveBeenCalledTimes(1);
    expect(mocks.gatewayClose).toHaveBeenCalledTimes(1);
  });
});

describe("createMobileConversations", () => {
  it("resolves the conversation services on demand", async () => {
    createMobileConversations();

    await expect(
      resolveWith(firstConstructed("conversations"), "resolveServices"),
    ).resolves.toEqual({
      authService: "auth",
      conversationReader: "reader",
      conversationService: "conversation-service",
    });
  });
});

describe("startPicaMobile", () => {
  it("listens on the stored port", async () => {
    await startPicaMobile(
      new StubRuntime(createConfig({ picaMobilePort: 4500 })),
      3000,
    );

    expect(mocks.gatewaySwitchTo).toHaveBeenCalledWith(
      4500,
      expect.any(Function),
    );
    const switchArguments = mocks.gatewaySwitchTo.mock.calls[0] as [
      number,
      () => Promise<void>,
    ];
    await expect(switchArguments[1]()).resolves.toBeUndefined();
    expect(gatewayOptions().reservedPort).toBe(3000);
  });

  it("prefers the loopback relay port while pages-core holds the app port", async () => {
    await startPicaMobile(
      new StubRuntime(
        createConfig({
          picaMobilePort: 4500,
          pagesCoreSecret: "s3cret",
          picaMobileRelayPort: 4711,
        }),
      ),
      3000,
    );

    expect(mocks.gatewaySwitchTo).toHaveBeenCalledWith(
      4711,
      expect.any(Function),
    );
  });

  it("does not listen without a stored port", async () => {
    await startPicaMobile(new StubRuntime(createConfig()), 3000);

    expect(mocks.gatewaySwitchTo).not.toHaveBeenCalled();
    expect(mocks.logDiagnostic).not.toHaveBeenCalled();
  });

  it("logs a port that cannot be bound and keeps the web server running", async () => {
    const error = new Error("EADDRINUSE");
    mocks.gatewaySwitchTo.mockRejectedValue(error);

    await expect(
      startPicaMobile(
        new StubRuntime(createConfig({ picaMobilePort: 3000 })),
        3000,
      ),
    ).resolves.toBeUndefined();

    expect(mocks.logDiagnostic).toHaveBeenCalledWith(
      "PicaMobileRuntime",
      "warn",
      "[pages] Pica Mobile cannot listen on port 3000. Store another port in Settings > Connections.",
      error,
    );
  });
});
