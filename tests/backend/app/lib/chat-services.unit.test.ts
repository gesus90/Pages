import { beforeEach, expect, it, vi } from "vitest";

import { createChatServices } from "@/app/lib/chat-services.server";
import { isSafeSvg } from "@/app/lib/settings-actions/svg-safety.server";
import { PicaAdminService } from "@/backend/service/chat/admin/PicaAdminService";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { ChatContextService } from "@/backend/service/chat/ChatContextService";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { ChatAnswerFileService } from "@/backend/service/chat/ChatAnswerFileService";
import { ChatAttachmentService } from "@/backend/service/chat/ChatAttachmentService";
import { ChatService } from "@/backend/service/chat/ChatService";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import { ChatSettingsService } from "@/backend/service/chat/ChatSettingsService";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";
import { readPicaInstructions } from "@/backend/service/chat/PicaInstructionFiles";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import type { Mock } from "vitest";
import type { ChatServicesInput } from "@/app/lib/chat-services.server";
import type { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import type { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import type { ResolvedAgentAssignment } from "@/backend/service/agents/AgentAssignmentResolution";

const { fakeClasses, opaque, partial } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock("@/app/lib/settings-actions/svg-safety.server", () => ({
  isSafeSvg: vi.fn(),
}));
vi.mock("@/backend/service/chat/admin/PicaAdminService", () =>
  fakeClasses({ PicaAdminService: ["protectOrigin"] }),
);
vi.mock("@/backend/database/repositories/AgentConnectionRepository", () =>
  fakeClasses({ AgentConnectionRepository: ["catalogs"] }),
);
vi.mock("@/backend/database/repositories/chat/ChatAcpSessionRepository", () =>
  fakeClasses({ ChatAcpSessionRepository: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatContextRepository", () =>
  fakeClasses({ ChatContextRepository: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatJobRepository", () =>
  fakeClasses({ ChatJobRepository: ["latest"] }),
);
vi.mock("@/backend/database/repositories/chat/ChatSteerRepository", () =>
  fakeClasses({ ChatSteerRepository: ["list", "selections"] }),
);
vi.mock("@/backend/service/chat/ChatContextService", () =>
  fakeClasses({ ChatContextService: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatAttachmentRepository", () =>
  fakeClasses({ ChatAttachmentRepository: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatSessionRepository", () =>
  fakeClasses({ ChatSessionRepository: [] }),
);
vi.mock("@/backend/database/repositories/chat/ChatSettingsRepository", () =>
  fakeClasses({ ChatSettingsRepository: [] }),
);
vi.mock("@/backend/database/repositories/UserSettingsRepository", () =>
  fakeClasses({ UserSettingsRepository: [] }),
);
vi.mock("@/backend/service/chat/ChatAnswerFileService", () =>
  fakeClasses({ ChatAnswerFileService: [] }),
);
vi.mock("@/backend/service/chat/ChatAttachmentService", () =>
  fakeClasses({ ChatAttachmentService: [] }),
);
vi.mock("@/backend/service/chat/ChatService", () =>
  fakeClasses({ ChatService: [] }),
);
vi.mock("@/backend/service/chat/ChatSessionService", () =>
  fakeClasses({ ChatSessionService: ["setDeletionEffects"] }),
);
vi.mock("@/backend/service/chat/ChatSettingsService", () =>
  fakeClasses({ ChatSettingsService: [] }),
);
vi.mock("@/backend/service/chat/ChatToolExecutor", () =>
  fakeClasses({ ChatToolExecutor: [] }),
);
vi.mock("@/backend/service/chat/acp/PicaAcpService", () =>
  fakeClasses({ PicaAcpService: ["forget", "cleanup", "stopAll"] }),
);
vi.mock("@/backend/service/chat/acp/PicaAcpWorkspace", () =>
  fakeClasses({ PicaAcpWorkspace: [] }),
);
vi.mock("@/backend/service/chat/acp/PicaBridge", () =>
  fakeClasses({ PicaBridge: [] }),
);
vi.mock("@/backend/service/chat/PicaInstructionFiles", () => ({
  readPicaInstructions: vi.fn(),
}));
vi.mock("@/backend/service/mcp/AgentIdentityService", () =>
  fakeClasses({ AgentIdentityService: [] }),
);
vi.mock("@/backend/storage/WikiFileStore", () =>
  fakeClasses({ WikiFileStore: [] }),
);

/** A Pica settings service whose gates record what passes them. */
interface PicaFixture {
  readonly service: PicaSettingsService;
  readonly requireEnabled: Mock<PicaSettingsService["requireEnabled"]>;
  readonly admit: Mock<(work: () => Promise<unknown>) => Promise<unknown>>;
  readonly requireCurrent: Mock<PicaSettingsService["requireCurrent"]>;
  readonly setStopHandler: Mock<PicaSettingsService["setStopHandler"]>;
}

function picaFixture(): PicaFixture {
  const requireEnabled = vi.fn<PicaSettingsService["requireEnabled"]>(
    async () => undefined,
  );
  const admit = vi.fn(async (work: () => Promise<unknown>) => work());
  const requireCurrent = vi.fn<PicaSettingsService["requireCurrent"]>(
    async () => undefined,
  );
  const setStopHandler = vi.fn<PicaSettingsService["setStopHandler"]>();
  return {
    service: partial<PicaSettingsService>({
      requireEnabled,
      admit,
      requireCurrent,
      setStopHandler,
    }),
    requireEnabled,
    admit,
    requireCurrent,
    setStopHandler,
  };
}

const CANCEL_ALL = vi.fn<ChatRequestRegistry["cancelAll"]>();
const REQUESTS = partial<ChatRequestRegistry>({ cancelAll: CANCEL_ALL });
const ACCOUNTS: ChatServicesInput["accounts"] = {
  users: opaque("users"),
  administration: opaque("administration"),
};
const ACP = {
  bridgeUrl: "http://127.0.0.1:3100/api/v1/pica-bridge",
  workspaceRoot: "/srv/pages/pica",
};

/** The chat input; `agents` and the optional parts replace the defaults. */
function chatInput(
  overrides: Partial<ChatServicesInput> = {},
): ChatServicesInput {
  return {
    database: opaque("database"),
    directory: "/srv/pages/data",
    accounts: ACCOUNTS,
    agents: {
      agentProfileService: opaque("profiles"),
      chatRequests: REQUESTS,
    },
    router: opaque("router"),
    ...overrides,
  };
}

/** The input of the Codex path with every part present. */
function acpInput(pica?: PicaSettingsService): ChatServicesInput {
  return chatInput({
    acp: ACP,
    agents: {
      picaSettingsService: pica,
      agentProfileService: opaque("profiles"),
      chatRequests: REQUESTS,
      agentPlanExecution: opaque("plan execution"),
      agentConnectionAccess: opaque("connection access"),
    },
  });
}

function sessionOptions(): ConstructorParameters<typeof ChatSessionService>[0] {
  return vi.mocked(ChatSessionService).mock.calls[0][0];
}

function acpOptions(): ConstructorParameters<typeof PicaAcpService>[0] {
  return vi.mocked(PicaAcpService).mock.calls[0][0];
}

beforeEach(() => {
  vi.resetAllMocks();
});

it.each(["acp", "agentPlanExecution", "agentConnectionAccess"] as const)(
  "keeps the Codex path off without %s",
  (missing) => {
    const input = acpInput();
    const services = createChatServices({
      ...input,
      ...(missing === "acp" ? { acp: undefined } : {}),
      agents: {
        ...input.agents,
        ...(missing === "acp" ? {} : { [missing]: undefined }),
      },
    });

    expect(services.picaAcpService).toBe(null);
    expect(services.picaBridge).toBe(null);
    expect(vi.mocked(PicaAcpService)).not.toHaveBeenCalled();
    expect(vi.mocked(PicaBridge)).not.toHaveBeenCalled();
    expect(
      ChatSessionService.prototype.setDeletionEffects,
    ).not.toHaveBeenCalled();
    expect(vi.mocked(ChatService).mock.calls[0][0]).not.toHaveProperty("acp");
  },
);

it("stores sessions, attachments and languages in their repositories", () => {
  const input = chatInput();
  const services = createChatServices(input);

  for (const repository of [
    ChatSessionRepository,
    ChatAttachmentRepository,
    UserSettingsRepository,
    ChatSettingsRepository,
  ]) {
    expect(vi.mocked(repository).mock.calls).toEqual([[input.database]]);
  }
  expect(vi.mocked(WikiFileStore).mock.calls).toEqual([
    ["/srv/pages/data/chat-attachments"],
  ]);
  expect(vi.mocked(ChatSettingsService).mock.calls[0]).toEqual([
    vi.mocked(ChatSettingsRepository).mock.instances[0],
    ACCOUNTS.administration,
  ]);
  expect(sessionOptions()).toMatchObject({
    sessions: vi.mocked(ChatSessionRepository).mock.instances[0],
    attachments: vi.mocked(ChatAttachmentRepository).mock.instances[0],
    settings: services.chatSettingsService,
    languages: vi.mocked(UserSettingsRepository).mock.instances[0],
    files: vi.mocked(WikiFileStore).mock.instances[0],
  });
  expect(services.chatSessionService).toBe(
    vi.mocked(ChatSessionService).mock.instances[0],
  );
  expect(services.chatSettingsService).toBe(
    vi.mocked(ChatSettingsService).mock.instances[0],
  );
});

it("opens sessions freely without Pica settings", async () => {
  createChatServices(chatInput());
  const { requireEnabled, admit } = sessionOptions();

  await expect(requireEnabled?.()).resolves.toBe(undefined);
  await expect(admit?.(async () => "opened")).resolves.toBe("opened");
});

it("lets the Pica settings gate and admit new sessions", async () => {
  const pica = picaFixture();
  createChatServices(acpInput(pica.service));
  const { requireEnabled, admit } = sessionOptions();

  await requireEnabled?.();
  expect(pica.requireEnabled).toHaveBeenCalledOnce();
  await expect(admit?.(async () => "admitted")).resolves.toBe("admitted");
  expect(pica.admit).toHaveBeenCalledOnce();
});

it("shows the latest job and the steering of a session as its activity", async () => {
  createChatServices(chatInput());
  const job = { usage: { context: opaque("context usage") } };
  vi.mocked(ChatJobRepository.prototype.latest).mockResolvedValue(partial(job));
  vi.mocked(ChatSteerRepository.prototype.list).mockResolvedValue([
    opaque("steer"),
  ]);
  vi.mocked(ChatSteerRepository.prototype.selections).mockResolvedValue([
    opaque("selection"),
  ]);

  await expect(
    sessionOptions().activity?.("user-1", "session-1"),
  ).resolves.toEqual({
    job,
    steers: [opaque("steer")],
    selections: [opaque("selection")],
  });
  expect(ChatJobRepository.prototype.latest).toHaveBeenCalledWith(
    "user-1",
    "session-1",
  );
  expect(ChatSteerRepository.prototype.list).toHaveBeenCalledWith("session-1");
  expect(ChatSteerRepository.prototype.selections).toHaveBeenCalledWith(
    "session-1",
  );
});

it("reads the context indicator from the latest job only when one exists", async () => {
  createChatServices(chatInput());
  const [options] = vi.mocked(ChatContextService).mock.calls[0];
  vi.mocked(ChatJobRepository.prototype.latest)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(partial({ usage: { context: null } }))
    .mockResolvedValueOnce(
      partial({ usage: { context: opaque("context usage") } }),
    );

  await expect(options.adapterContext?.("user-1", "session-1")).resolves.toBe(
    null,
  );
  await expect(options.adapterContext?.("user-1", "session-1")).resolves.toBe(
    null,
  );
  await expect(
    options.adapterContext?.("user-1", "session-1"),
  ).resolves.toEqual(opaque("context usage"));
});

it("leaves context summaries to the native agents", async () => {
  const input = chatInput();
  const services = createChatServices(input);
  vi.mocked(AgentConnectionRepository.prototype.catalogs).mockReturnValue(
    opaque("catalogs"),
  );

  const [options] = vi.mocked(ChatContextService).mock.calls[0];
  expect(services.chatContextService).toBe(
    vi.mocked(ChatContextService).mock.instances[0],
  );
  expect(options).toMatchObject({
    sessions: services.chatSessionService,
    messages: vi.mocked(ChatSessionRepository).mock.instances[0],
    contexts: vi.mocked(ChatContextRepository).mock.instances[0],
    agents: input.agents.agentProfileService,
    requests: REQUESTS,
  });
  expect(vi.mocked(AgentConnectionRepository).mock.calls).toEqual([
    [input.database],
  ]);
  await expect(
    options.execution.run(opaque("request"), new AbortController().signal),
  ).rejects.toMatchObject({
    name: "ChatError",
    code: "nativeContextManaged",
  });
});

it("checks attachments and answer files with the same settings and SVG check", () => {
  const services = createChatServices(chatInput());

  const fileParts = {
    attachments: vi.mocked(ChatAttachmentRepository).mock.instances[0],
    settings: services.chatSettingsService,
    files: vi.mocked(WikiFileStore).mock.instances[0],
    isSafeSvg,
  };
  expect(vi.mocked(ChatAttachmentService).mock.calls[0][0]).toEqual({
    sessions: vi.mocked(ChatSessionRepository).mock.instances[0],
    ...fileParts,
  });
  expect(services.chatAttachmentService).toBe(
    vi.mocked(ChatAttachmentService).mock.instances[0],
  );
  expect(vi.mocked(ChatAnswerFileService).mock.calls[0][0]).toEqual(fileParts);
});

it("runs tools as the current identity over the shared operation router", () => {
  const input = chatInput();
  const services = createChatServices(input);

  expect(vi.mocked(AgentIdentityService).mock.calls[0]).toEqual([
    ACCOUNTS.users,
    ACCOUNTS.administration,
  ]);
  expect(vi.mocked(ChatToolExecutor).mock.calls[0][0]).toEqual({
    router: input.router,
    identities: vi.mocked(AgentIdentityService).mock.instances[0],
  });
  expect(vi.mocked(PicaAdminService).mock.calls).toEqual([[ACCOUNTS]]);
  expect(services.picaAdminService).toBe(
    vi.mocked(PicaAdminService).mock.instances[0],
  );
  expect(PicaAdminService.prototype.protectOrigin).not.toHaveBeenCalled();
});

it("protects the public origin from Pica's administration tools", () => {
  createChatServices(chatInput({ protectedOrigin: "https://pages.example" }));

  expect(PicaAdminService.prototype.protectOrigin).toHaveBeenCalledWith(
    "https://pages.example",
  );
});

it("builds the Codex path on the bridge, the journal and the shared chat parts", () => {
  const input = acpInput();
  const services = createChatServices(input);

  expect(vi.mocked(PicaBridge).mock.calls).toEqual([[ACP.bridgeUrl]]);
  expect(vi.mocked(PicaAcpWorkspace).mock.calls).toEqual([[ACP.workspaceRoot]]);
  expect(acpOptions()).toMatchObject({
    plans: input.agents.agentPlanExecution,
    jobs: vi.mocked(ChatJobRepository).mock.instances[1],
    steers: vi.mocked(ChatSteerRepository).mock.instances[1],
    acpSessions: vi.mocked(ChatAcpSessionRepository).mock.instances[0],
    messages: vi.mocked(ChatSessionRepository).mock.instances[0],
    attachments: services.chatAttachmentService,
    answerFiles: vi.mocked(ChatAnswerFileService).mock.instances[0],
    bridge: services.picaBridge,
    tools: vi.mocked(ChatToolExecutor).mock.instances[0],
    adminTools: services.picaAdminService,
    access: input.agents.agentConnectionAccess,
    sessions: services.chatSessionService,
    requests: REQUESTS,
    workspace: vi.mocked(PicaAcpWorkspace).mock.instances[0],
  });
  expect(services.picaAcpService).toBe(
    vi.mocked(PicaAcpService).mock.instances[0],
  );
  expect(services.picaBridge).toBe(vi.mocked(PicaBridge).mock.instances[0]);
});

it("answers with the Codex path when it exists", () => {
  const input = acpInput();
  const services = createChatServices(input);

  expect(services.chatService).toBe(vi.mocked(ChatService).mock.instances[0]);
  expect(vi.mocked(ChatService).mock.calls[0][0]).toEqual({
    mode: "acp",
    acp: services.picaAcpService,
    sessions: services.chatSessionService,
    context: services.chatContextService,
    messages: vi.mocked(ChatSessionRepository).mock.instances[0],
    attachments: services.chatAttachmentService,
    answerFiles: vi.mocked(ChatAnswerFileService).mock.instances[0],
    settings: services.chatSettingsService,
    protectedInstructions: readPicaInstructions,
    agents: input.agents.agentProfileService,
    requests: REQUESTS,
    languages: vi.mocked(UserSettingsRepository).mock.instances[0],
  });
});

it("forgets and cleans up the Codex state of a deleted session", async () => {
  createChatServices(acpInput());
  vi.mocked(PicaAcpService.prototype.forget).mockResolvedValue(undefined);
  vi.mocked(PicaAcpService.prototype.cleanup).mockResolvedValue(undefined);

  const [effects] = vi.mocked(ChatSessionService.prototype.setDeletionEffects)
    .mock.calls[0];
  await effects.before?.("user-1", "session-1");
  await effects.after?.("session-1");

  expect(PicaAcpService.prototype.forget).toHaveBeenCalledWith(
    "user-1",
    "session-1",
  );
  expect(PicaAcpService.prototype.cleanup).toHaveBeenCalledWith("session-1");
});

it("starts Codex jobs directly without Pica settings", async () => {
  createChatServices(acpInput());
  const { admit, requireCurrent } = acpOptions();
  const assignment = opaque<ResolvedAgentAssignment>("assignment");

  await expect(admit?.(async () => "started")).resolves.toBe("started");
  await expect(requireCurrent?.("user-1", assignment)).resolves.toBe(undefined);
});

it("lets the Pica settings admit Codex jobs and check the current assignment", async () => {
  const pica = picaFixture();
  createChatServices(acpInput(pica.service));
  const { admit, requireCurrent } = acpOptions();
  const assignment = opaque<ResolvedAgentAssignment>("assignment");

  await expect(admit?.(async () => "admitted")).resolves.toBe("admitted");
  expect(pica.admit).toHaveBeenCalledOnce();
  await requireCurrent?.("user-1", assignment);
  expect(pica.requireCurrent).toHaveBeenCalledWith("user-1", assignment);
});

it("stops Codex jobs and cancels running answers when Pica is switched off", async () => {
  const pica = picaFixture();
  createChatServices(acpInput(pica.service));
  vi.mocked(PicaAcpService.prototype.stopAll).mockResolvedValue(undefined);
  CANCEL_ALL.mockResolvedValue(undefined);

  const [stop] = pica.setStopHandler.mock.calls[0];
  await stop();

  expect(PicaAcpService.prototype.stopAll).toHaveBeenCalledOnce();
  expect(CANCEL_ALL).toHaveBeenCalledOnce();
});

it("only cancels running answers on a stop without the Codex path", async () => {
  const pica = picaFixture();
  createChatServices(
    chatInput({
      agents: {
        picaSettingsService: pica.service,
        agentProfileService: opaque("profiles"),
        chatRequests: REQUESTS,
      },
    }),
  );
  CANCEL_ALL.mockResolvedValue(undefined);

  const [stop] = pica.setStopHandler.mock.calls[0];
  await stop();

  expect(PicaAcpService.prototype.stopAll).not.toHaveBeenCalled();
  expect(CANCEL_ALL).toHaveBeenCalledOnce();
});
