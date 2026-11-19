import path from "node:path";

import { AgentChatQuestionRepository } from "@/backend/database/repositories/conversation/AgentChatQuestionRepository";
import { AgentChatQuestionService } from "@/backend/service/conversation/AgentChatQuestionService";
import { AgentChatSettingsRepository } from "@/backend/database/repositories/conversation/AgentChatSettingsRepository";
import { ChatAnswerModelRepository } from "@/backend/database/repositories/conversation/ChatAnswerModelRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ConversationAgentChatRepository } from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";
import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationDecisionRepository } from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import { ConversationDeliveryRepository } from "@/backend/database/repositories/conversation/ConversationDeliveryRepository";
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
import { ConversationAttachmentLibraryRepository } from "@/backend/database/repositories/conversation/ConversationAttachmentLibraryRepository";
import { ConversationEmbedDomainRepository } from "@/backend/database/repositories/conversation/ConversationEmbedDomainRepository";
import { ConversationLinkPreviewRepository } from "@/backend/database/repositories/conversation/ConversationLinkPreviewRepository";
import { ConversationMediaOverviewRepository } from "@/backend/database/repositories/conversation/ConversationMediaOverviewRepository";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { ChatViewPreferenceService } from "@/backend/service/conversation/content/ChatViewPreferenceService";
import { ConversationAgentFiles } from "@/backend/service/conversation/content/ConversationAgentFiles";
import { ConversationAttachments } from "@/backend/service/conversation/content/ConversationAttachments";
import { ConversationAttachmentContent } from "@/backend/service/conversation/content/ConversationAttachmentContent";
import { ConversationAttachmentLibrary } from "@/backend/service/conversation/content/ConversationAttachmentLibrary";
import { ConversationAttachmentReferences } from "@/backend/service/conversation/content/ConversationAttachmentReferences";
import { FfmpegVideoFrameReader } from "@/backend/service/conversation/content/ConversationVideoFrames";
import { ConversationLinks } from "@/backend/service/conversation/content/ConversationLinks";
import { ConversationMediaOverviewService } from "@/backend/service/conversation/content/ConversationMediaOverviewService";
import { ConversationMessageContent } from "@/backend/service/conversation/content/ConversationMessageContent";
import { HttpConversationLinkFetcher } from "@/backend/service/conversation/links/HttpConversationLinkFetcher";
import { SimulatedConversationLinkFetcher } from "@/backend/service/conversation/links/SimulatedConversationLinkFetcher";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationChatDecisions } from "@/backend/service/conversation/ConversationChatDecisions";
import { ConversationContextReader } from "@/backend/service/conversation/ConversationContextReader";
import { ConversationMentionAliases } from "@/backend/service/conversation/ConversationMentionAliases";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { sharedConversationAnswerStream } from "@/backend/service/conversation/ConversationAnswerStream";
import { ConversationGroupSummaries } from "@/backend/service/conversation/ConversationGroupSummaries";
import { ConversationGroupSummaryScheduler } from "@/backend/service/conversation/ConversationGroupSummaryScheduler";
import { ConversationAttachmentExpiry } from "@/backend/service/conversation/content/ConversationAttachmentExpiry";
import { sharedConversationGeneratedImages } from "@/backend/service/conversation/content/ConversationGeneratedImages";
import { ConversationObserverModel } from "@/backend/service/conversation/ConversationObserverModel";
import { ConversationObserverMonitor } from "@/backend/service/conversation/ConversationObserverMonitor";
import { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";
import { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import { ConversationReplySettingsService } from "@/backend/service/conversation/ConversationReplySettingsService";
import { createChatCallIce } from "@/backend/service/conversation/ChatCallIce";
import { ChatCallService } from "@/backend/service/conversation/ChatCallService";
import { ConversationService } from "@/backend/service/conversation/ConversationService";
import { createConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import { ConversationVoiceRecognition } from "@/backend/service/conversation/ConversationVoiceRecognition";
import { ConversationVoiceStore } from "@/backend/service/conversation/ConversationVoiceStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { voiceMaximumDurationMs } from "@/backend/config/SpeechRecognitionConfig";

import type { ChatCallSetting } from "@/backend/config/ChatCallConfig";
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

/** The stored conversations of the chat page and Pica Mobile. */
export interface ConversationApplicationServices {
  readonly conversationDirectory: ConversationDirectory;
  readonly conversationReader: ConversationReader;
  readonly conversationService: ConversationService;
  /** The calls of the direct chat between two people. */
  readonly chatCallService: ChatCallService;
  /** The answers of agents in conversations. */
  readonly conversationAgentReplies: ConversationAgentReplies;
  /** The stored context of groups. */
  readonly conversationContextReader: ConversationContextReader;
  /** How the group observer fared, for members and administrators. */
  readonly conversationObserverMonitor: ConversationObserverMonitor;
  /** Who answers in a group chat. */
  readonly conversationReplySettingsService: ConversationReplySettingsService;
  /** The longest voice message Pages takes, in milliseconds. */
  readonly conversationVoiceMaximumMs: number;
  /** Turns a recording into text before sending, for chats whose messages are text alone. */
  readonly conversationVoiceRecognition: ConversationVoiceRecognition;
  /** The Pages tools with which agents read chats and send messages. */
  readonly agentChatService: AgentChatService;
  /** The interim messages and questions with answer buttons of chat agents. */
  readonly agentChatQuestions: AgentChatQuestionService;
  /** The chain and hourly limits of the chat of agents, and the release of a paused one. */
  readonly conversationAgentGuard: ConversationAgentGuard;
  /** Who reads the conversations that only agents take part in. */
  readonly conversationOversight: ConversationOversight;
  /** The hourly limit under Settings → Agents. */
  readonly agentChatSettingsService: AgentChatSettingsService;
  /** The files of conversation messages. */
  readonly conversationAttachments: ConversationAttachments;
  /** The attachments of chats as their agents search and read them. */
  readonly conversationAttachmentLibrary: ConversationAttachmentLibrary;
  /** The links of messages and the domains that may be embedded. */
  readonly conversationLinks: ConversationLinks;
  /** "Medien & Dateien" of a chat: its files and links, and chosen files as ZIP. */
  readonly conversationMediaOverview: ConversationMediaOverviewService;
  /** The card states and the split width of a person. */
  readonly chatViewPreferences: ChatViewPreferenceService;
}

/** What the conversation services are built from. */
export interface ConversationServicesInput {
  readonly database: Database;
  /** The data directory; the audio of voice messages lies below it. */
  readonly directory: string;
  readonly events: PagesEventPublisher;
  /** Runs the answers of agents. */
  readonly runner: ConversationAgentRunner;
  /** The speech model and the longest recording of `config.toml`. */
  readonly speech?: SpeechRecognitionSetting;
  /** The STUN and TURN servers of audio calls of `config.toml`. */
  readonly chatCalls?: ChatCallSetting;
  /** The group observer on Pica's chat model. */
  readonly observer: ConversationObserverInput;
  /** The origin users reach Pages at; links to it embed. */
  readonly publicUrl?: string;
  /**
   * Fetches the preview data of links. By default the HTTP fetch,
   * and while the simulation is on a fetch that contacts no network.
   */
  readonly linkFetcher?: ConversationLinkFetcher;
}

/** What the group observer runs on. */
export interface ConversationObserverInput {
  /** Pica's central model choice and its authorized resolver. */
  readonly pica: Pick<PicaSettingsService, "resolve" | "requireCurrent">;
  /** The ACP path its sessions open on; `null` without one. */
  readonly plans: PlanExecution | null;
  /** The simulated observer; set only while the simulation is on. */
  readonly simulation: SimulatedConversationObserver | null;
  /**
   * The decision model of the instance with its default rules, which chooses
   * agents in group chats.
   */
  readonly decision: {
    readonly model: Pick<ConversationDecisionModel, "ask">;
    readonly settings: Pick<ChatDecisionSettingsService, "rules" | "modelView">;
  };
  /**
   * Where observer sessions get their working directories: a folder the
   * worker units of the service manager see.
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
  var pagesConversationExpiry: ConversationAttachmentExpiry | undefined;
}

/**
 * Tells the live view whether an account is a member of a conversation.
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
  const files = conversationVoiceFiles(input.directory);
  const store = new EmployeeStore(database);
  const directory = new ConversationDirectory({
    users: new UserRepository(database),
    lookups: new WikiLookupRepository(database),
    jobTitles: () => store.identities().jobTitles(),
    aliases: new ConversationMentionAliases(
      new AuthorizationRepository(database),
    ),
  });
  const decisions = new ConversationDecisionRepository(database);
  const replySettings = new ConversationReplySettingsRepository(database);
  const content = createContent(input, conversations, directory);
  const conversationReader = new ConversationReader({
    conversations,
    messages,
    directory,
    files,
    decisions,
    content: content.reader,
    deliveries: new ConversationDeliveryRepository(database),
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
  startConversationBackground(
    conversationAgentReplies,
    observer,
    content,
    input.observer.isBackgroundOwner,
  );
  return assembleConversationServices({
    input,
    conversations,
    messages,
    directory,
    files,
    decisions,
    replySettings,
    content,
    conversationReader,
    events,
    observer,
    agentChat,
    conversationAgentReplies,
  });
}

function assembleConversationServices(parts: {
  readonly input: ConversationServicesInput;
  readonly conversations: ConversationRepository;
  readonly messages: ConversationMessageRepository;
  readonly directory: ConversationDirectory;
  readonly files: WikiFileStore;
  readonly decisions: ConversationDecisionRepository;
  readonly replySettings: ConversationReplySettingsRepository;
  readonly content: ContentParts;
  readonly conversationReader: ConversationReader;
  readonly events: ConversationEvents;
  readonly observer: ObserverParts;
  readonly agentChat: ReturnType<typeof createAgentChatParts>;
  readonly conversationAgentReplies: ConversationAgentReplies;
}): ConversationApplicationServices {
  const {
    input,
    conversations,
    messages,
    directory,
    files,
    decisions,
    replySettings,
    content,
    conversationReader,
    events,
    observer,
    agentChat,
    conversationAgentReplies,
  } = parts;
  const { database } = input;
  const { guard: conversationAgentGuard } = agentChat;
  const messaging = createMessagingServices(input, {
    conversations,
    messages,
    directory,
    files,
    conversationReader,
    content,
    events,
    guard: conversationAgentGuard,
  });
  return {
    conversationDirectory: directory,
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
    ...messaging,
    chatCallService: new ChatCallService({
      conversations: messaging.conversationService,
      directory,
      publisher: input.events,
      ice: createChatCallIce(input.chatCalls),
    }),
    conversationAttachments: content.attachments,
    conversationAttachmentLibrary: content.library,
    conversationLinks: content.links,
    conversationMediaOverview: content.media,
    chatViewPreferences: new ChatViewPreferenceService(
      new ChatViewPreferenceRepository(database),
    ),
    conversationAgentGuard,
    agentChatSettingsService: agentChat.settingsService,
    conversationOversight: agentChat.oversight,
  };
}

function createMessagingServices(
  input: ConversationServicesInput,
  parts: {
    readonly conversations: ConversationRepository;
    readonly messages: ConversationMessageRepository;
    readonly directory: ConversationDirectory;
    readonly files: WikiFileStore;
    readonly conversationReader: ConversationReader;
    readonly content: ContentParts;
    readonly events: ConversationEvents;
    readonly guard: ConversationAgentGuard;
  },
): Pick<
  ConversationApplicationServices,
  | "conversationVoiceMaximumMs"
  | "conversationVoiceRecognition"
  | "conversationService"
  | "agentChatQuestions"
  | "agentChatService"
> {
  const { database } = input;
  const conversationVoiceMaximumMs = voiceMaximumDurationMs(input.speech);
  const users = new UserRepository(database);
  const voices = new ConversationVoiceStore(
    parts.files,
    conversationVoiceMaximumMs,
  );
  const transcriber = createConversationTranscriber({ speech: input.speech });
  const conversationService = new ConversationService({
    conversations: parts.conversations,
    messages: parts.messages,
    reader: parts.conversationReader,
    attachments: parts.content.attachments,
    directory: parts.directory,
    voices,
    files: parts.files,
    transcriber,
    events: parts.events,
    publisher: input.events,
  });
  return {
    conversationVoiceMaximumMs,
    conversationVoiceRecognition: new ConversationVoiceRecognition({
      voices,
      files: parts.files,
      transcriber,
    }),
    conversationService,
    agentChatQuestions: new AgentChatQuestionService({
      users,
      service: conversationService,
      reader: parts.conversationReader,
      questions: new AgentChatQuestionRepository(database),
      publisher: input.events,
    }),
    agentChatService: new AgentChatService({
      users,
      groups: new UserGroupRepository(database),
      conversations: parts.conversations,
      reader: parts.conversationReader,
      service: conversationService,
      directory: parts.directory,
      guard: parts.guard,
      events: parts.events,
    }),
  };
}

function conversationVoiceFiles(directory: string): WikiFileStore {
  return new WikiFileStore(path.join(directory, "conversation-voice"));
}

function startConversationBackground(
  replies: ConversationAgentReplies,
  observer: ObserverParts,
  content: ContentParts,
  isBackgroundOwner: boolean,
): void {
  globalThis.pagesConversationAgentReplies?.();
  globalThis.pagesConversationAgentReplies = replies.start();
  if (isBackgroundOwner) {
    startObserverBackground(replies, observer.summaries);
    sweepContent(content);
  }
}

/** The guard, the oversight and the settings of the chat between agents. */
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
    references: content.references,
    attachments: content.attachments,
    generatedImages: sharedConversationGeneratedImages(),
    content: content.reader,
    answerStream: {
      open: (target) =>
        sharedConversationAnswerStream().open({
          ...target,
          recordModel: (messageId, model) =>
            new ChatAnswerModelRepository(input.database).record(
              messageId,
              model,
            ),
        }),
      ownerOf: (conversationId) =>
        shared.conversations.createdBy(conversationId),
    },
  });
}

/** The content of messages: files, links and what reads both. */
interface ContentParts {
  readonly attachments: ConversationAttachments;
  readonly links: ConversationLinks;
  readonly reader: ConversationMessageContent;
  readonly library: ConversationAttachmentLibrary;
  readonly references: ConversationAttachmentReferences;
  readonly media: ConversationMediaOverviewService;
}

function hostOf(origin: string | undefined): string[] {
  return origin === undefined ? [] : [new URL(origin).hostname.toLowerCase()];
}

function createContent(
  input: ConversationServicesInput,
  conversations: ConversationRepository,
  directory: ConversationDirectory,
): ContentParts {
  const { database } = input;
  const files = new WikiFileStore(
    path.join(input.directory, "conversation-files"),
  );
  const attachments = new ConversationAttachments({
    attachments: new ConversationAttachmentRepository(database),
    conversations,
    files,
    directory,
  });
  const libraryRows = new ConversationAttachmentLibraryRepository(database);
  const references = new ConversationAttachmentReferences({
    library: libraryRows,
    conversations,
    directory,
  });
  const ownHosts = hostOf(input.publicUrl);
  const previews = new ConversationLinkPreviewRepository(database);
  const links = new ConversationLinks({
    previews,
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
    reader: new ConversationMessageContent(attachments, links, references),
    references,
    media: new ConversationMediaOverviewService({
      library: libraryRows,
      messages: new ConversationMediaOverviewRepository(database),
      previews,
      conversations,
      files,
      directory,
    }),
    library: new ConversationAttachmentLibrary({
      library: libraryRows,
      conversations,
      files,
      directory,
      content: new ConversationAttachmentContent({
        transcriber: createConversationTranscriber({ speech: input.speech }),
        frames: new FfmpegVideoFrameReader(),
      }),
    }),
  };
}

/**
 * Removes files and preview data nothing refers to any more, once at the
 * start, and starts the regular removal of agents' files after 72 hours;
 * a second wiring replaces the expiry of the first.
 */
function sweepContent(content: ContentParts): void {
  void Promise.all([content.attachments.sweep(), content.links.sweep()]).catch(
    (error: unknown) => {
      logCaughtError("ConversationContent", error);
    },
  );
  void globalThis.pagesConversationExpiry?.shutdown();
  const expiry = new ConversationAttachmentExpiry(content.attachments);
  expiry.start();
  globalThis.pagesConversationExpiry = expiry;
}

/** The parts of the group observer. */
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
