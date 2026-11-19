import { randomUUID } from "node:crypto";

import { ConversationError } from "@/backend/error/ConversationError";

import { ChatCallSignals } from "./ChatCallSignals";
import { conversationChangedEvent } from "./ConversationServiceHelpers";

import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type {
  ChatCallAction,
  ChatCallIceConfiguration,
  ChatCallList,
  ChatCallSignal,
  ChatCallSignalBatch,
  ChatCallStatus,
  ChatCallView,
} from "@/definition/ChatCall";
import type { User } from "@/definition/User";
import type {
  ConversationAccounts,
  ConversationDirectory,
} from "./ConversationDirectory";
import type { ChatCallIce } from "./ChatCallIce";
import type { ConversationService } from "./ConversationService";

/**
 * How long a running call survives without a sign of life from one side.
 * @remarks
 * Each browser reads the signals of its call without a break, so a side that
 * stays silent for this long has closed the page or lost the network.
 */
const IDLE_MILLISECONDS = 60_000;

/** How long a request for signals waits for news before it answers empty. */
const SIGNAL_WAIT_MILLISECONDS = 20_000;

interface StoredChatCall {
  readonly id: string;
  readonly conversationId: string;
  readonly callerId: string;
  readonly recipientId: string;
  status: ChatCallStatus;
  /** When each of the two accounts last took part in a running call, in milliseconds. */
  readonly seenAt: Map<string, number>;
}

/** What the calls read and announce. */
export interface ChatCallServiceDependencies {
  readonly conversations: Pick<ConversationService, "openDirect">;
  readonly directory: Pick<ConversationDirectory, "read">;
  /** Tells the live view of this process about a changed conversation. */
  readonly publisher: { publish(event: PagesEvent): void };
  /** Issues the STUN and TURN servers of a running call. */
  readonly ice: ChatCallIce;
  /** The clock in milliseconds; the time of the system by default. */
  readonly now?: () => number;
}

/**
 * The calls of the direct chat between two people.
 * @remarks
 * Caller and recipient come from the server: the caller is the signed-in
 * account, the recipient the other member of the direct chat the caller may
 * open. A call lives in the memory of the process only, one per direct chat,
 * and only its two members read or change it; everybody else gets the answer
 * for a call that does not exist. Both members hear of every change through
 * the live view of the conversation. An account takes part in one running
 * call at a time. Once a call runs, the two members pass the offer, the
 * answer and the ICE candidates of their audio connection on through the
 * service, which checks account, participation and the state of the call at
 * every step, and receive temporary TURN credentials for that call only. A
 * running call whose side has been silent for a minute ends for both.
 */
export class ChatCallService {
  private readonly dependencies: ChatCallServiceDependencies;
  private readonly calls = new Map<string, StoredChatCall>();
  private readonly signals = new ChatCallSignals();

  public constructor(dependencies: ChatCallServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Rings a person from the direct chat with them.
   * @param person - The signed-in caller.
   * @param participantId - The user ID of the person to call.
   * @returns The call; the one that already runs in this direct chat, if any.
   * @throws {ConversationError} `invalid` for the own account, an agent or an
   * account that cannot be written to.
   */
  public async start(
    person: User,
    participantId: string,
  ): Promise<ChatCallView> {
    this.expireIdle();
    const accounts = await this.dependencies.directory.read();
    const recipient = accounts.find(participantId);
    if (
      recipient === undefined ||
      recipient.participant.kind !== "human" ||
      !recipient.isAvailable ||
      participantId === person.id
    )
      throw new ConversationError("invalid");
    const conversation = await this.dependencies.conversations.openDirect(
      person,
      participantId,
    );
    const existing = this.calls.get(conversation.id);
    if (existing !== undefined) return this.view(person, existing, accounts);
    const call: StoredChatCall = {
      id: randomUUID(),
      conversationId: conversation.id,
      callerId: person.id,
      recipientId: participantId,
      status: "ringing",
      seenAt: new Map(),
    };
    this.calls.set(call.conversationId, call);
    this.announce(call);
    return this.view(person, call, accounts);
  }

  /**
   * Answers, cancels or ends a call the person takes part in.
   * @param person - The signed-in account.
   * @param callId - The ID of the call.
   * @param action - What the person does with it.
   * @throws {ConversationError} `not_found` for a call the person is no
   * member of, as for a missing one; `forbidden` for an action the person's
   * role does not allow, such as the caller accepting; `invalid` for an
   * action the state of the call does not allow, such as accepting while
   * either side is in another running call.
   */
  public async respond(
    person: User,
    callId: string,
    action: ChatCallAction,
  ): Promise<void> {
    this.expireIdle();
    const call = this.find(person, callId);
    if (call === undefined) throw new ConversationError("not_found");
    const isRecipient = call.recipientId === person.id;
    this.check(call, action, isRecipient);
    if (action === "accept") this.activate(call);
    else this.end(call);
    this.announce(call);
  }

  /**
   * Passes a connection offer, answer or ICE candidate on to the other member
   * of a running call.
   * @param person - The signed-in account.
   * @param callId - The ID of the call.
   * @param signal - What the browser tells the other one.
   * @throws {ConversationError} `not_found` for a call the person is no
   * member of, as for a missing one; `invalid` while the call still rings.
   */
  public async signal(
    person: User,
    callId: string,
    signal: ChatCallSignal,
  ): Promise<void> {
    const call = this.requireRunning(person, callId);
    this.signals.append(call.id, person.id, signal);
  }

  /**
   * Reads what the other member of a running call sent, and waits for news
   * when there is none yet.
   * @param person - The signed-in account.
   * @param callId - The ID of the call.
   * @param options - The last sequence the person has seen and the signal of
   * the request, which ends the wait when the browser drops it.
   * @returns The new signals, empty after the wait; `isEnded` once the call is over.
   * @throws {ConversationError} `not_found` and `invalid` as for {@link signal}.
   */
  public async readSignals(
    person: User,
    callId: string,
    options: { readonly after: number; readonly abort: AbortSignal },
  ): Promise<ChatCallSignalBatch> {
    const call = this.requireRunning(person, callId);
    const ready = this.signals.read(call.id, person.id, options.after);
    if (ready.length > 0) return { signals: ready, isEnded: false };
    await this.signals.wait(call.id, person.id, {
      milliseconds: SIGNAL_WAIT_MILLISECONDS,
      abort: options.abort,
    });
    this.expireIdle();
    if (this.find(person, callId)?.status !== "active")
      return { signals: [], isEnded: true };
    this.touch(call, person.id);
    return {
      signals: this.signals.read(call.id, person.id, options.after),
      isEnded: false,
    };
  }

  /**
   * Issues the STUN and TURN servers of a running call.
   * @param person - The signed-in account.
   * @param callId - The ID of the call.
   * @returns The servers; TURN credentials only for a member of this call.
   * @throws {ConversationError} `not_found` and `invalid` as for {@link signal}.
   */
  public async iceServers(
    person: User,
    callId: string,
  ): Promise<ChatCallIceConfiguration> {
    const call = this.requireRunning(person, callId);
    return this.dependencies.ice.configuration(call.id);
  }

  /**
   * Lists the calls the person takes part in.
   * @param person - The signed-in account.
   */
  public async list(person: User): Promise<ChatCallList> {
    this.expireIdle();
    const own = [...this.calls.values()].filter(
      (call) => call.callerId === person.id || call.recipientId === person.id,
    );
    if (own.length === 0) return { calls: [] };
    const accounts = await this.dependencies.directory.read();
    return {
      calls: own.map((call) => this.view(person, call, accounts)),
    };
  }

  private find(person: User, callId: string): StoredChatCall | undefined {
    return [...this.calls.values()].find(
      (call) =>
        call.id === callId &&
        (call.callerId === person.id || call.recipientId === person.id),
    );
  }

  private requireRunning(person: User, callId: string): StoredChatCall {
    this.expireIdle();
    const call = this.find(person, callId);
    if (call === undefined) throw new ConversationError("not_found");
    if (call.status !== "active") throw new ConversationError("invalid");
    this.touch(call, person.id);
    return call;
  }

  private activate(call: StoredChatCall): void {
    const isBusy = [...this.calls.values()].some(
      (other) =>
        other !== call &&
        other.status === "active" &&
        [call.callerId, call.recipientId].some(
          (id) => other.callerId === id || other.recipientId === id,
        ),
    );
    if (isBusy) throw new ConversationError("invalid");
    call.status = "active";
    this.touch(call, call.callerId);
    this.touch(call, call.recipientId);
  }

  private end(call: StoredChatCall): void {
    this.calls.delete(call.conversationId);
    this.signals.close(call.id);
  }

  private touch(call: StoredChatCall, personId: string): void {
    call.seenAt.set(personId, this.now());
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  /** Ends the running calls whose side has been silent for too long. */
  private expireIdle(): void {
    const limit = this.now() - IDLE_MILLISECONDS;
    for (const call of [...this.calls.values()]) {
      const isIdle =
        call.status === "active" &&
        [call.callerId, call.recipientId].some(
          (id) => (call.seenAt.get(id) ?? 0) < limit,
        );
      if (!isIdle) continue;
      this.end(call);
      this.announce(call);
    }
  }

  private check(
    call: StoredChatCall,
    action: ChatCallAction,
    isRecipient: boolean,
  ): void {
    if (action === "hangup") {
      if (call.status !== "active") throw new ConversationError("invalid");
      return;
    }
    const isRecipientAction = action === "accept" || action === "decline";
    if (isRecipientAction !== isRecipient)
      throw new ConversationError("forbidden");
    if (call.status !== "ringing") throw new ConversationError("invalid");
  }

  private view(
    person: User,
    call: StoredChatCall,
    accounts: ConversationAccounts,
  ): ChatCallView {
    const isOutgoing = call.callerId === person.id;
    const otherId = isOutgoing ? call.recipientId : call.callerId;
    const other = accounts.find(otherId);
    return {
      id: call.id,
      status: call.status,
      isOutgoing,
      participant: {
        id: otherId,
        name: other?.participant.name ?? "",
        avatarImageUrl:
          other?.user.avatarType === "image"
            ? (other.user.avatarImageUrl ?? null)
            : null,
      },
    };
  }

  private announce(call: StoredChatCall): void {
    this.dependencies.publisher.publish(
      conversationChangedEvent(call.conversationId),
    );
  }
}
