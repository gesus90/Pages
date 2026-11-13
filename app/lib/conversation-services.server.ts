import path from "node:path";

import { AgentChatSettingsRepository } from "@/backend/database/repositories/conversation/AgentChatSettingsRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ConversationAgentChatRepository } from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";
import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import { ConversationGroupContextRepository } from "@/backend/database/repositories/conversation/ConversationGroupContextRepository";
import { ConversationObserverRunRepository } from "@/backend/database/repositories/conversation/ConversationObserverRunRepository";
import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { logCaughtError } from "@/backend/logging/Logger";
import { AgentChatService } from "@/backend/service/conversation/AgentChatService";
import { AgentChatSettingsService } from "@/backend/service/conversation/AgentChatSettingsService";
import { ConversationAgentGuard } from "@/backend/service/conversation/ConversationAgentGuard";
import { ChatViewPreferenceRepository } from "@/backend/database/repositories/conversation/ChatViewPreferenceRepository";
import { ConversationAttachmentRepository } from "@/backend/database/repositories/conversation/ConversationAttachmentRepository";
import { ConversationEmbedDomainRepository } from "@/backend/database/repositories/conversation/ConversationEmbedDomainRepository";
import { ConversationLinkPreviewRepository } from "@/backend/database/repositories/conversation/ConversationLinkPreviewRepository";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { ChatViewPreferenceService } from "@/backend/service/conversation/content/ChatViewPreferenceService";
import { ConversationAgentFiles } from "@/backend/service/conversation/content/ConversationAgentFiles";
import { ConversationAttachments } from "@/backend/service/conversation/content/ConversationAttachments";
import { ConversationLinks } from "@/backend/service/conversation/content/ConversationLinks";
import { ConversationMessageContent } from "@/backend/service/conversation/content/ConversationMessageContent";
import { HttpConversationLinkFetcher } from "@/backend/service/conversation/links/HttpConversationLinkFetcher";
import { SimulatedConversationLinkFetcher } from "@/backend/service/conversation/links/SimulatedConversationLinkFetcher";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationChatDecisions } from "@/backend/service/conversation/ConversationChatDecisions";
import { ConversationContextReader } from "@/backend/service/conversation/ConversationContextReader";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { ConversationGroupSummaries } from "@/backend/service/conversation/ConversationGroupSummaries";
import { ConversationGroupSummaryScheduler } from "@/backend/service/conversation/ConversationGroupSummaryScheduler";
import { ConversationObserverModel } from "@/backend/service/conversation/ConversationObserverModel";
import { ConversationObserverMonitor } from "@/backend/service/conversation/ConversationObserverMonitor";
import { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";
import { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import { ConversationReplySettingsService } from "@/backend/service/conversation/ConversationReplySettingsService";
import { ConversationService } from "@/backend/service/conversation/ConversationService";
import { createConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import { ConversationVoiceStore } from "@/backend/service/conversation/ConversationVoiceStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { voiceMaximumDurationMs } from "@/backend/config/SpeechRecognitionConfig";

import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { SimulatedConversationObserver } from "@/backend/agents/simulation/SimulatedConversationObserver";
import type { Database } from "@/backend/database/Database";
import type { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type { ConversationLinkFetcher } from "@/backend/service/conversation/links/ConversationLinkFetcher";
import type { ConversationAgentRunner } from "@/backend/service/conversation/ConversationAgentReplies";
import type { ConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import type { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import type { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";
import type { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { User } from "@/definition/User";

/** The stored conversations of the chat page and Pica Mobile (PAGE-278). */
export interface ConversationApplicationServices {
  readonly conversationReader: ConversationReader;
  readonly conversationService: ConversationService;
  /** The answers of agents in conversations (PAGE-276). */
  readonly conversationAgentReplies: ConversationAgentReplies;
  /** The stored context of groups (PAGE-296). */
  readonly conversationContextReader: ConversationContextReader;
  /** How the group observer fared, for members and administrators (PAGE-340). */
  readonly conversationObserverMonitor: ConversationObserverMonitor;
  /** Who answers in a group chat (PAGE-317). */
  readonly conversationReplySettingsService: ConversationReplySettingsService;
  /** The longest voice message Pages takes, in milliseconds (PAGE-277). */
  readonly conversationVoiceMaximumMs: number;
  /** The Pages tools with which agents read chats and send messages (PAGE-311). */
  readonly agentChatService: AgentChatService;
  /** The chain and hourly limits of the chat of agents, and the release of a paused one (PAGE-311). */
  readonly conversationAgentGuard: ConversationAgentGuard;
  /** Who reads the conversations that only agents take part in (PAGE-311). */
  readonly conversationOversight: ConversationOversight;
  /** The hourly limit under Settings → Agents (PAGE-311). */
  readonly agentChatSettingsService: AgentChatSettingsService;
  /** The files of conversation messages (PAGE-298). */
  readonly conversationAttachments: ConversationAttachments;
  /** The links of messages and the domains that may be embedded (PAGE-298). */
  readonly conversationLinks: ConversationLinks;
  /** The card states and the split width of a person (PAGE-298). */
  readonly chatViewPreferences: ChatViewPreferenceService;
}

/** What the conversation services are built from. */
export interface ConversationServicesInput {
  readonly database: Database;
  /** The data directory; the audio of voice messages lies below it. */
  readonly directory: string;
  readonly events: PagesEventPublisher;
  /** Runs the answers of agents (PAGE-276). */
  readonly runner: ConversationAgentRunner;
  /** The speech model and the longest recording of `config.toml` (PAGE-277). */
  readonly speech?: SpeechRecognitionSetting;
  /** The group observer on Pica's chat model (PAGE-296). */
  readonly observer: ConversationObserverInput;
  /** The origin users reach Pages at; links to it embed (PAGE-298). */
  readonly publicUrl?: string;
  /**
   * Fetches the preview data of links (PAGE-298). By default the HTTP fetch,
   * and while the simulation is on a fetch that contacts no network.
   */
  readonly linkFetcher?: ConversationLinkFetcher;
}

/** What the group observer runs on (PAGE-296). */
export interface ConversationObserverInput {
  /** Pica's central model choice and its authorized resolver. */
  readonly pica: Pick<PicaSettingsService, "resolve" | "requireCurrent">;
  /** The ACP path its sessions open on; `null` without one. */
  readonly plans: PlanExecution | null;
  /** The simulated observer; set only while the simulation is on. */
  readonly simulation: SimulatedConversationObserver | null;
  /**
   * The decision model of the instance with its default rules, which chooses
   * agents in group chats (PAGE-317, PAGE-379).
   */
  readonly decision: {
    readonly model: Pick<ConversationDecisionModel, "ask">;
    readonly settings: Pick<ChatDecisionSettingsService, "rules" | "modelView">;
  };
  /**
   * Where observer sessions get their working directories: a folder the
   * worker units of the service manager see (PAGE-340).
   */
  readonly directoryRoot: string;
  /**
   * Whether this process runs the background work: the summaries and the
   * end of answers an earlier process left open.
   */
  readonly isBackgroundOwner: boolean;
}

declare global {
  var pagesConversationAgentReplies: (() => void) | undefined;
  var pagesConversationSummaries: ConversationGroupSummaryScheduler | undefined;
}

/**
 * Tells the live view whether an account is a member of a conversation.
 *
 * @param database - The open database.
 * @returns The membership check of the live view.
 */
export function conversationMembership(database: Database): {
  isMember(actor: User, conversationId: string): Promise<boolean>;
} {
  const conversations = new ConversationRepository(database);
  return {
    isMember: async (actor, conversationId) =>
      (await conversations.findForMember(conversationId, actor.id)) !== null,
  };
}

/**
 * Wires the conversations on the shared database: their reads and writes,
 * the audio of voice messages in the file store, the recognition of their
 * text and the answers of agents, which follow the committed messages of the
 * process from now on; a second wiring replaces the first.
 *
 * @param input - Database, data directory, the publisher of the live view
 * and the runner of agent answers.
 * @returns The reader, the writing service and the agent answers.
 */
export function createConversationServices(
  input: ConversationServicesInput,
): ConversationApplicationServices {
  const { database } = input;
  const conversations = new ConversationRepository(database);
  const messages = new ConversationMessageRepository(database);
  const files = new WikiFileStore(
    path.join(input.directory, "conversation-voice"),
  );
  const store = new EmployeeStore(database);
  const directory = new ConversationDirectory({
    users: new UserRepository(database),
    lookups: new WikiLookupRepository(database),
    jobTitles: () => store.identities().jobTitles(),
  });
  const decisions = new ConversationDecisionRepository(database);
  const replySettings = new ConversationReplySettingsRepository(database);
  const content = createContent(input, conversations);
  const conversationReader = new ConversationReader({
    conversations,
    messages,
    directory,
    files,
    decisions,
    content: content.reader,
  });
  const events = sharedConversationEvents();
  const observer = createObserver(input, {
    conversations,
    messages,
    directory,
  });
  const agentChat = createAgentChatParts(input, conversationReader);
  const { guard: conversationAgentGuard } = agentChat;
  const conversationAgentReplies = createReplies(input, {
    shared: { conversations, messages, directory },
    observer,
    replySettings,
    decisions,
    agents: store.employees(),
    events,
    guard: conversationAgentGuard,
    content,
  });
  globalThis.pagesConversationAgentReplies?.();
  globalThis.pagesConversationAgentReplies = conversationAgentReplies.start();
  if (input.observer.isBackgroundOwner) {
    startObserverBackground(conversationAgentReplies, observer.summaries);
    sweepContent(content);
  }
  const conversationVoiceMaximumMs = voiceMaximumDurationMs(input.speech);
  const conversationService = new ConversationService({
    conversations,
    messages,
    reader: conversationReader,
    attachments: content.attachments,
    directory,
    voices: new ConversationVoiceStore(files, conversationVoiceMaximumMs),
    files,
    transcriber: createConversationTranscriber({ speech: input.speech }),
    events,
    publisher: input.events,
  });
  return {
    conversationReader,
    conversationAgentReplies,
    conversationContextReader: observer.reader,
    conversationObserverMonitor: observer.monitor,
    conversationReplySettingsService: new ConversationReplySettingsService({
      conversations,
      settings: replySettings,
      decisions,
      instance: input.observer.decision.settings,
      directory,
      publisher: input.events,
    }),
    conversationVoiceMaximumMs,
    conversationService,
    conversationAttachments: content.attachments,
    conversationLinks: content.links,
    chatViewPreferences: new ChatViewPreferenceService(
      new ChatViewPreferenceRepository(database),
    ),
    conversationAgentGuard,
    agentChatSettingsService: agentChat.settingsService,
    conversationOversight: agentChat.oversight,
    agentChatService: new AgentChatService({
      users: new UserRepository(database),
      groups: new UserGroupRepository(database),
      conversations,
      reader: conversationReader,
      service: conversationService,
      directory,
      guard: conversationAgentGuard,
      events,
    }),
  };
}

/** The guard, the oversight and the settings of the chat between agents (PAGE-311). */
function createAgentChatParts(
  input: ConversationServicesInput,
  reader: ConversationReader,
): {
  readonly guard: ConversationAgentGuard;
  readonly oversight: ConversationOversight;
  readonly settingsService: AgentChatSettingsService;
} {
  const { database } = input;
  const chat = new ConversationAgentChatRepository(database);
  const settings = new AgentChatSettingsRepository(database);
  const oversight = new ConversationOversight({
    authorization: new AuthorizationRepository(database),
    chat,
    reader,
  });
  return {
    oversight,
    settingsService: new AgentChatSettingsService(settings),
    guard: new ConversationAgentGuard({
      chat,
      settings,
      members: reader,
      oversight,
      publisher: input.events,
    }),
  };
}

/** What the answers of agents in conversations are wired from. */
interface ReplyParts {
  readonly shared: {
    readonly conversations: ConversationRepository;
    readonly messages: ConversationMessageRepository;
    readonly directory: ConversationDirectory;
  };
  readonly observer: ObserverParts;
  readonly replySettings: ConversationReplySettingsRepository;
  readonly decisions: ConversationDecisionRepository;
  /** The agents with their `AGENT.md`, which the decision model reads the specialization of. */
  readonly agents: AgentEmployeeRepository;
  readonly events: ConversationEvents;
  readonly guard: ConversationAgentGuard;
  readonly content: ContentParts;
}

function createReplies(
  input: ConversationServicesInput,
  parts: ReplyParts,
): ConversationAgentReplies {
  const { shared, observer, content } = parts;
  return new ConversationAgentReplies({
    ...shared,
    runner: input.runner,
    rounds: observer.rounds,
    contexts: observer.reader,
    replySettings: parts.replySettings,
    decisions: new ConversationChatDecisions({
      messages: shared.messages,
      rounds: observer.rounds,
      decisions: parts.decisions,
      model: input.observer.decision.model,
      defaults: input.observer.decision.settings,
      agents: parts.agents,
      publisher: input.events,
    }),
    events: parts.events,
    publisher: input.events,
    guard: parts.guard,
    agentFiles: new ConversationAgentFiles(),
    attachments: content.attachments,
    content: content.reader,
  });
}

/** The content of messages: files, links and what reads both (PAGE-298). */
interface ContentParts {
  readonly attachments: ConversationAttachments;
  readonly links: ConversationLinks;
  readonly reader: ConversationMessageContent;
}

function hostOf(origin: string | undefined): string[] {
  return origin === undefined ? [] : [new URL(origin).hostname.toLowerCase()];
}

function createContent(
  input: ConversationServicesInput,
  conversations: ConversationRepository,
): ContentParts {
  const { database } = input;
  const attachments = new ConversationAttachments({
    attachments: new ConversationAttachmentRepository(database),
    conversations,
    files: new WikiFileStore(path.join(input.directory, "conversation-files")),
  });
  const ownHosts = hostOf(input.publicUrl);
  const links = new ConversationLinks({
    previews: new ConversationLinkPreviewRepository(database),
    domains: new ConversationEmbedDomainRepository(database),
    conversations,
    fetcher:
      input.linkFetcher ??
      (currentAgentSimulationMode().isActive
        ? new SimulatedConversationLinkFetcher()
        : new HttpConversationLinkFetcher()),
    files: new WikiFileStore(
      path.join(input.directory, "conversation-link-images"),
    ),
    publisher: input.events,
    ownHosts: () => ownHosts,
  });
  return {
    attachments,
    links,
    reader: new ConversationMessageContent(attachments, links),
  };
}

/** Removes files and preview data nothing refers to any more, once at the start. */
function sweepContent(content: ContentParts): void {
  void Promise.all([content.attachments.sweep(), content.links.sweep()]).catch(
    (error: unknown) => {
      logCaughtError("ConversationContent", error);
    },
  );
}

/** The parts of the group observer (PAGE-296). */
interface ObserverParts {
  readonly rounds: ConversationRoundRepository;
  readonly reader: ConversationContextReader;
  readonly monitor: ConversationObserverMonitor;
  readonly summaries: ConversationGroupSummaries;
}

function createObserver(
  input: ConversationServicesInput,
  shared: {
    readonly conversations: ConversationRepository;
    readonly messages: ConversationMessageRepository;
    readonly directory: ConversationDirectory;
  },
): ObserverParts {
  const { database } = input;
  const rounds = new ConversationRoundRepository(database);
  const contexts = new ConversationGroupContextRepository(database);
  const runs = new ConversationObserverRunRepository(database);
  const monitor = new ConversationObserverMonitor(runs);
  const reader = new ConversationContextReader({
    ...shared,
    contexts,
    observer: monitor,
  });
  const model = new ConversationObserverModel({
    pica: input.observer.pica,
    plans: input.observer.plans,
    runs,
    simulation: input.observer.simulation,
    directoryRoot: input.observer.directoryRoot,
  });
  return {
    rounds,
    reader,
    monitor,
    summaries: new ConversationGroupSummaries({
      ...shared,
      contexts,
      rounds,
      model,
    }),
  };
}

/**
 * Ends the answers an earlier process left open and starts the summaries of
 * groups; a second wiring replaces the scheduler of the first.
 */
function startObserverBackground(
  replies: ConversationAgentReplies,
  summaries: ConversationGroupSummaries,
): void {
  // Only what an earlier process left: answers of this process keep running.
  const processStartedAt = new Date(Date.now() - process.uptime() * 1000);
  void replies.recover(processStartedAt).catch((error: unknown) => {
    logCaughtError("ConversationAgentReplies", error);
  });
  const previous = globalThis.pagesConversationSummaries;
  void previous?.shutdown().catch((error: unknown) => {
    logCaughtError("ConversationGroupSummaryScheduler", error);
  });
  const scheduler = new ConversationGroupSummaryScheduler(
    summaries,
    sharedConversationEvents(),
  );
  scheduler.start();
  globalThis.pagesConversationSummaries = scheduler;
}
