import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { ChatError } from "@/backend/error/ChatErrors";
import {
  AGENT_CALL_INTERRUPTION_MARKER,
  AGENT_CALL_MAXIMUM_UTTERANCE_MS,
} from "@/definition/AgentCall";

import {
  isSilentUtterance,
  measureUtterance,
  noiseReasonOf,
} from "./AgentCallAudio";
import { AgentCallLiveCalls } from "./AgentCallLive";
import { AgentCallTurn } from "./AgentCallTurn";

import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import type { SpeechRecognitionService } from "@/backend/service/speech/SpeechRecognitionService";
import type { AgentSpeechService } from "@/backend/service/speech/AgentSpeechService";
import type {
  AgentCallEvent,
  AgentCallFailure,
  AgentCallReadiness,
  AgentCallSpokenReport,
  AgentCallTimings,
} from "@/definition/AgentCall";
import type { AgentEmployeeVoice } from "@/definition/SpeechSynthesis";
import type { User } from "@/definition/User";
import type { AgentEmployeeSessions } from "../AgentEmployeeSessions";
import type { AgentCallLiveHandle, AgentCallLiveSend } from "./AgentCallLive";
import type { AgentCallTurnOptions, SpokenSentence } from "./AgentCallTurn";

/** What the voice calls of agents are built from. */
export interface AgentCallDependencies {
  readonly sessions: Pick<
    AgentEmployeeSessions,
    "startVoiceTurn" | "stop" | "directSessionId" | "voiceOf"
  >;
  readonly recognition: Pick<SpeechRecognitionService, "transcribe" | "path">;
  readonly speech: Pick<
    AgentSpeechService,
    "speak" | "speakStream" | "readiness"
  >;
  readonly messages: Pick<
    ChatSessionRepository,
    "findByClientId" | "findMessage" | "replaceAnswerContent"
  >;
  /** The clock in milliseconds; the monotonic clock of the process by default. */
  readonly now?: () => number;
}

/** One utterance of a call. */
export interface AgentCallUtterance {
  readonly agentId: string;
  /** The ID the browser gave the call. */
  readonly callId: string;
  /** The running number of the utterance in the call, from 1. */
  readonly turn: number;
  /** The finished recording as a WAV file. */
  readonly audio: Buffer;
  /** Ends the turn: the person interrupted, hung up or lost the connection. */
  readonly signal: AbortSignal;
}

/** Speaks the phrases of one answer with the voice the agent saved. */
export type AgentCallSpeaker = (
  voice: AgentEmployeeVoice | null,
) => AgentCallTurnOptions["speak"];

/** One utterance of the live path whose transcript is already final. */
export interface AgentCallTranscribedUtterance {
  readonly agentId: string;
  readonly callId: string;
  readonly turn: number;
  /** The confirmed transcript; it is checked for noise again. */
  readonly text: string;
  /** When the end of the utterance was confirmed, on the clock of the service. */
  readonly startedAt: number;
  readonly signal: AbortSignal;
  /** Hands the audio of each phrase to the browser while it is synthesized. */
  readonly speaker: AgentCallSpeaker;
  /** What the live path measured besides the times of the answer. */
  readonly extraTimings?: () => Partial<AgentCallTimings>;
}

/** What the service keeps of a turn so its answer can be marked afterwards. */
interface KeptTurn {
  readonly turn: AgentCallTurn;
  readonly sessionId: string;
  readonly settled: Promise<void>;
  isReported: boolean;
}

const IDENTIFIER = /^[a-zA-Z0-9-]{1,60}$/u;

/** How many finished turns the service remembers for marking. */
const KEPT_TURNS = 200;

const COMPONENT = "AgentCallService";

/** The ID of the message of a turn: the same turn of the same call is stored once. */
function messageIdOf(callId: string, turn: number): string {
  return `call-${callId}-${turn}`;
}

function failureOf(error: unknown): AgentCallFailure {
  if (error instanceof AgentEmployeeError && error.code === "busy")
    return "agent_busy";
  if (error instanceof AgentEmployeeError && error.code === "invalidInput")
    return "invalid";
  return "agent_unavailable";
}

/**
 * Where the speech of an answer ended, as a position in the text it spoke.
 * @param sentences - The sentences handed to the voice, in order.
 * @param spokenCharacters - What the person heard, in characters of speech.
 * @returns Turn, run of text and the fraction of its text that was spoken.
 */
function interruptionPoint(
  sentences: readonly SpokenSentence[],
  spokenCharacters: number,
): { readonly sentence: SpokenSentence; readonly end: number } | null {
  let passed = 0;
  for (const sentence of sentences) {
    if (spokenCharacters < passed + sentence.speechLength) {
      const share =
        Math.max(0, spokenCharacters - passed) / sentence.speechLength;
      return {
        sentence,
        end:
          sentence.start + Math.round((sentence.end - sentence.start) * share),
      };
    }
    passed += sentence.speechLength;
  }
  return null;
}

/** Cuts a text back to the last space, so the marker never splits a word. */
function wordStart(text: string, position: number): number {
  if (position <= 0) return 0;
  if (position >= text.length) return text.length;
  if (/\s/u.test(text.charAt(position))) return position;
  const space = text.lastIndexOf(" ", position);
  return space < 0 ? 0 : space;
}

/**
 * The voice calls of the direct chat with an agent.
 * @remarks
 * One utterance, already cut out by the browser's speech detection, is one
 * turn. A recording without enough sound, a text the recognizer returned for
 * silence or noise, and a muted microphone, which sends nothing, start no
 * agent turn. Otherwise the recognized text is the person's message in the
 * session of their direct chat, the agent answers once in that session, and
 * every finished sentence of the answer is spoken with the voice the agent
 * saved while the rest is written. Both texts are stored by the session as
 * usual; the ID of the message is derived from call and turn, so a repeated
 * turn is stored once. Audio is never stored. A new turn or a closed request
 * stops the running answer; the browser then reports how much it played so
 * the stored answer shows where the speech ended.
 */
export class AgentCallService {
  private readonly dependencies: AgentCallDependencies;
  private readonly now: () => number;
  private readonly running = new Map<string, AbortController>();
  private readonly settledTurns = new Map<string, Promise<void>>();
  private readonly kept = new Map<string, KeptTurn>();
  private readonly liveCalls: AgentCallLiveCalls;

  public constructor(dependencies: AgentCallDependencies) {
    this.dependencies = dependencies;
    this.now = dependencies.now ?? (() => performance.now());
    this.liveCalls = new AgentCallLiveCalls({
      service: this,
      recognition: dependencies.recognition,
      speech: dependencies.speech,
      now: this.now,
    });
  }

  /**
   * Opens or resumes the live path of a call for one connection.
   * @param person - The signed-in caller.
   * @param identity - The agent and the ID the browser gave the call.
   * @param send - Sends an event to this connection.
   * @returns The handle the connection steers the call with.
   * @throws {AgentEmployeeError} `invalidInput` for a malformed ID, `notFound`
   * for an agent that does not exist.
   */
  public async openLive(
    person: User,
    identity: { readonly agentId: string; readonly callId: string },
    send: AgentCallLiveSend,
  ): Promise<AgentCallLiveHandle> {
    if (!IDENTIFIER.test(identity.agentId) || !IDENTIFIER.test(identity.callId))
      throw new AgentEmployeeError("invalidInput");
    return this.liveCalls.open(person, identity, send);
  }

  /**
   * Tells what a call with an agent needs and whether it is there.
   * @param agentId - The agent to call.
   * @returns The state of recognition and speech output and of the saved voice.
   * @throws {AgentEmployeeError} `notFound` for an agent that does not exist.
   */
  public async readiness(agentId: string): Promise<AgentCallReadiness> {
    const voice = await this.dependencies.sessions.voiceOf(agentId);
    if (voice === null) throw new AgentEmployeeError("notFound");
    const [recognitionPath, speech] = await Promise.all([
      this.dependencies.recognition.path(),
      this.dependencies.speech.readiness(voice.voiceId),
    ]);
    return {
      recognition: recognitionPath === null ? "not_configured" : "ready",
      synthesis: speech.isConfigured ? "ready" : "not_configured",
      isVoiceMissing: speech.isVoiceMissing,
      recognitionPath: recognitionPath ?? "buffered",
      synthesisPath: speech.path,
    };
  }

  /**
   * Answers one utterance of a call.
   * @param person - The signed-in caller.
   * @param utterance - Agent, call, running number and the recording.
   * @param emit - Receives each event as soon as it exists.
   * @remarks
   * Returns when the answer is complete and spoken, or the turn was cancelled.
   */
  public async turn(
    person: User,
    utterance: AgentCallUtterance,
    emit: (event: AgentCallEvent) => void,
  ): Promise<void> {
    await this.exclusive(person, utterance, emit, (signal) =>
      this.answer(person, { ...utterance, signal }, emit),
    );
  }

  /**
   * Answers one utterance of the live path once its transcript is final.
   * @param person - The signed-in caller.
   * @param utterance - Agent, call, running number, transcript and the speaker.
   * @param emit - Receives each event as soon as it exists.
   * @remarks
   * A turn whose message is already stored answers `duplicate` and starts
   * nothing, so a repeated end after a lost connection stays one turn.
   */
  public async transcribedTurn(
    person: User,
    utterance: AgentCallTranscribedUtterance,
    emit: (event: AgentCallEvent) => void,
  ): Promise<void> {
    await this.exclusive(person, utterance, emit, (signal) =>
      this.answerTranscript(person, { ...utterance, signal }, emit),
    );
  }

  /**
   * Stops the running answer of a person's call with an agent, because the
   * person speaks again or hung up.
   * @param person - The signed-in caller.
   * @param agentId - The agent of the call.
   */
  public async stopAnswer(person: User, agentId: string): Promise<void> {
    const key = `${person.id}:${agentId}`;
    const running = this.running.get(key);
    if (running === undefined) return;
    this.running.delete(key);
    await this.interrupt(person, agentId, running);
  }

  /**
   * Marks an answer the person interrupted at the place its speech ended.
   * @param person - The signed-in caller.
   * @param report - How much of the answer the browser played.
   * @remarks
   * Only the stored answer text of that turn changes: a marker stands where
   * the speech ended and the rest of the text stays. A repeated report
   * changes nothing.
   */
  public async reportSpoken(
    person: User,
    report: AgentCallSpokenReport,
  ): Promise<void> {
    const kept = this.kept.get(`${person.id}:${report.callId}:${report.turn}`);
    if (kept === undefined || kept.isReported) return;
    kept.isReported = true;
    await kept.settled;
    const point = interruptionPoint(
      kept.turn.sentences,
      report.spokenCharacters,
    );
    if (point === null) return;
    const { turn: turnNumber, segment } = point.sentence;
    if (kept.turn.lastSegmentOf(turnNumber) !== segment) return;
    const messageId = kept.turn.storedMessages.get(turnNumber);
    const length = kept.turn.lengthOf(turnNumber, segment);
    if (messageId === undefined || length === null || length === 0) return;
    const message = await this.dependencies.messages.findMessage(
      kept.sessionId,
      messageId,
    );
    if (
      message?.role !== "assistant" ||
      message.content.includes(AGENT_CALL_INTERRUPTION_MARKER)
    )
      return;
    const at = wordStart(
      message.content,
      Math.round((point.end / length) * message.content.length),
    );
    await this.dependencies.messages.replaceAnswerContent(
      kept.sessionId,
      messageId,
      `${message.content.slice(0, at).trimEnd()}${AGENT_CALL_INTERRUPTION_MARKER}${message.content.slice(at).trimStart()}`.trim(),
    );
  }

  // One answer per person and agent: a new turn stops the one before it.
  private async exclusive(
    person: User,
    utterance: Pick<
      AgentCallUtterance,
      "agentId" | "callId" | "turn" | "signal"
    >,
    emit: (event: AgentCallEvent) => void,
    run: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const { agentId, callId, turn } = utterance;
    if (
      !IDENTIFIER.test(agentId) ||
      !IDENTIFIER.test(callId) ||
      !Number.isSafeInteger(turn) ||
      turn < 1
    )
      return emit({ type: "failed", code: "invalid" });
    const key = `${person.id}:${agentId}`;
    const controller = new AbortController();
    const abort = (): void => controller.abort();
    utterance.signal.addEventListener("abort", abort, { once: true });
    const previous = this.running.get(key);
    this.running.set(key, controller);
    try {
      if (previous) await this.interrupt(person, agentId, previous);
      await run(controller.signal);
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      logCaughtError(COMPONENT, error);
      emit({ type: "failed", code: failureOf(error) });
    } finally {
      utterance.signal.removeEventListener("abort", abort);
      if (this.running.get(key) === controller) this.running.delete(key);
    }
  }

  private async interrupt(
    person: User,
    agentId: string,
    previous: AbortController,
  ): Promise<void> {
    previous.abort();
    await this.dependencies.sessions.stop(person, agentId);
    await this.settledTurns.get(`${person.id}:${agentId}`);
  }

  private async answer(
    person: User,
    utterance: AgentCallUtterance,
    emit: (event: AgentCallEvent) => void,
  ): Promise<void> {
    const { agentId, callId, turn, audio, signal } = utterance;
    const startedAt = this.now();
    const clientMessageId = messageIdOf(callId, turn);
    if (await this.isStored(person, agentId, clientMessageId))
      return emit({ type: "duplicate" });
    const readiness = await this.readiness(agentId);
    if (readiness.recognition !== "ready")
      return emit({ type: "failed", code: "recognition_not_configured" });
    if (readiness.synthesis !== "ready")
      return emit({ type: "failed", code: "synthesis_not_configured" });
    const facts = measureUtterance(audio);
    if (facts === null || facts.durationMs > AGENT_CALL_MAXIMUM_UTTERANCE_MS)
      return emit({ type: "failed", code: "invalid" });
    // No provider is asked for a recording without sound: it costs nothing and starts no turn.
    if (isSilentUtterance(facts))
      return emit({ type: "silent", reason: "silence" });
    const text = await this.recognize(audio, signal, emit);
    if (text === null || signal.aborted) return;
    await this.respond(
      person,
      {
        ...utterance,
        text,
        clientMessageId,
        startedAt,
        speaker: (voice) => this.sentenceSpeaker(voice, emit),
      },
      emit,
    );
  }

  private async answerTranscript(
    person: User,
    utterance: AgentCallTranscribedUtterance,
    emit: (event: AgentCallEvent) => void,
  ): Promise<void> {
    const clientMessageId = messageIdOf(utterance.callId, utterance.turn);
    if (await this.isStored(person, utterance.agentId, clientMessageId))
      return emit({ type: "duplicate" });
    const readiness = await this.readiness(utterance.agentId);
    if (readiness.synthesis !== "ready")
      return emit({ type: "failed", code: "synthesis_not_configured" });
    const noise = noiseReasonOf(utterance.text);
    if (noise !== null) return emit({ type: "silent", reason: noise });
    if (utterance.signal.aborted) return;
    await this.respond(
      person,
      { ...utterance, text: utterance.text.trim(), clientMessageId },
      emit,
    );
  }

  private async isStored(
    person: User,
    agentId: string,
    clientMessageId: string,
  ): Promise<boolean> {
    const sessionId = await this.dependencies.sessions.directSessionId(
      agentId,
      person.id,
    );
    return (
      sessionId !== null &&
      (await this.dependencies.messages.findByClientId(
        sessionId,
        clientMessageId,
      )) !== null
    );
  }

  // The buffered path hands each sentence over as one whole file.
  private sentenceSpeaker(
    voice: AgentEmployeeVoice | null,
    emit: (event: AgentCallEvent) => void,
  ): AgentCallTurnOptions["speak"] {
    return async (phrase) => {
      const outcome = await this.dependencies.speech.speak({
        text: phrase.text,
        voiceId: voice?.voiceId ?? null,
        speedTenths: voice?.speedTenths ?? 10,
        signal: phrase.signal,
      });
      if (!outcome.ok) return outcome;
      if (phrase.signal.aborted) return { ok: true };
      phrase.markAudio();
      emit({
        type: "sentence",
        index: phrase.index,
        text: phrase.text,
        mimeType: outcome.mimeType,
        playbackRate: outcome.playbackRate,
        audio: outcome.audio.toString("base64"),
      });
      return { ok: true };
    };
  }

  private async recognize(
    audio: Buffer,
    signal: AbortSignal,
    emit: (event: AgentCallEvent) => void,
  ): Promise<string | null> {
    const outcome = await this.dependencies.recognition.transcribe({
      audio: Buffer.from(audio),
      mimeType: "audio/wav",
      signal,
    });
    if (!outcome.ok) {
      emit({
        type: "failed",
        code:
          outcome.code === "not_configured"
            ? "recognition_not_configured"
            : "recognition_failed",
      });
      return null;
    }
    const noise = noiseReasonOf(outcome.text);
    if (noise !== null) {
      emit({ type: "silent", reason: noise });
      return null;
    }
    return outcome.text.trim();
  }

  private async respond(
    person: User,
    input: Pick<
      AgentCallTranscribedUtterance,
      | "agentId"
      | "callId"
      | "turn"
      | "signal"
      | "text"
      | "startedAt"
      | "speaker"
      | "extraTimings"
    > & { readonly clientMessageId: string },
    emit: (event: AgentCallEvent) => void,
  ): Promise<void> {
    const { agentId, signal, text, clientMessageId, startedAt } = input;
    const voice = await this.dependencies.sessions.voiceOf(agentId);
    const turn = new AgentCallTurn({
      speak: input.speaker(voice),
      emit,
      signal,
      now: this.now,
      startedAt,
    });
    turn.markTranscript();
    emit({ type: "transcript", text });
    const key = `${person.id}:${agentId}`;
    let release: () => void = () => undefined;
    this.settledTurns.set(
      key,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    try {
      const isStarted = await this.dependencies.sessions.startVoiceTurn(
        person,
        {
          agentId,
          text,
          clientMessageId,
          answerTap: turn,
          signal,
        },
      );
      if (!isStarted) return emit({ type: "failed", code: "agent_busy" });
      this.stopWhenCancelled(person, agentId, signal);
      await this.keep(person, input, turn);
      await turn.finish();
      const timings = { ...turn.timings(), ...input.extraTimings?.() };
      if (!signal.aborted && turn.failedStep === null)
        emit({ type: "done", timings });
      this.logTurn(turn, timings, signal.aborted);
    } catch (error: unknown) {
      if (signal.aborted) return;
      if (error instanceof ChatError && error.code === "messageAlreadySent")
        return emit({ type: "duplicate" });
      logCaughtError(COMPONENT, error);
      emit({ type: "failed", code: failureOf(error) });
    } finally {
      release();
    }
  }

  // The answer runs as a job of its own: ending the request alone would let it write on.
  private stopWhenCancelled(
    person: User,
    agentId: string,
    signal: AbortSignal,
  ): void {
    const stop = (): void => {
      this.dependencies.sessions
        .stop(person, agentId)
        .catch((error: unknown) => {
          logCaughtError(COMPONENT, error);
        });
    };
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  }

  private async keep(
    person: User,
    input: Pick<AgentCallUtterance, "agentId" | "callId" | "turn">,
    turn: AgentCallTurn,
  ): Promise<void> {
    const sessionId = await this.dependencies.sessions.directSessionId(
      input.agentId,
      person.id,
    );
    if (sessionId === null) return;
    this.kept.set(`${person.id}:${input.callId}:${input.turn}`, {
      turn,
      sessionId,
      settled:
        this.settledTurns.get(`${person.id}:${input.agentId}`) ??
        Promise.resolve(),
      isReported: false,
    });
    for (const key of this.kept.keys()) {
      if (this.kept.size <= KEPT_TURNS) break;
      this.kept.delete(key);
    }
  }

  private logTurn(
    turn: AgentCallTurn,
    timings: AgentCallTimings,
    isInterrupted: boolean,
  ): void {
    logEvent({
      level: "info",
      event: "agent.call.turn",
      component: COMPONENT,
      message: "A voice call turn ended",
      metadata: {
        ...timings,
        sentences: turn.sentences.length,
        reportedSentences: turn.reportedCount,
        isInterrupted,
      },
    });
  }
}
