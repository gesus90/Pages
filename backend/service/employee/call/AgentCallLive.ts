import { logCaughtError } from "@/backend/logging/Logger";

import { AgentCallRecognizer } from "./AgentCallRecognizer";

import type { AgentCallRecognition } from "./AgentCallRecognizer";

import type { AgentSpeechService } from "@/backend/service/speech/AgentSpeechService";
import type { SpeechRecognitionService } from "@/backend/service/speech/SpeechRecognitionService";
import type {
  AgentCallEvent,
  AgentCallLiveEvent,
  AgentCallTimings,
} from "@/definition/AgentCall";
import type { User } from "@/definition/User";
import type { AgentCallService, AgentCallSpeaker } from "./AgentCallService";

/** What the live calls are built from. */
export interface AgentCallLiveDependencies {
  readonly service: Pick<
    AgentCallService,
    "transcribedTurn" | "stopAnswer" | "reportSpoken" | "readiness"
  >;
  readonly recognition: Pick<SpeechRecognitionService, "transcribe">;
  readonly speech: Pick<AgentSpeechService, "speakStream">;
  readonly now: () => number;
}

/** Sends one event to the browser of the call. */
export type AgentCallLiveSend = (event: AgentCallLiveEvent) => void;

/** One utterance that the browser is sending or has ended. */
interface LiveUtterance {
  readonly recognizer: AgentCallRecognizer;
  readonly controller: AbortController;
}

/** The answer that is being spoken. */
interface LiveAnswer {
  readonly turn: number;
  readonly controller: AbortController;
  readonly window: PlaybackWindow;
}

/** How many phrases may wait in the browser beside the one that plays. */
const PHRASES_AHEAD = 1;

/** The time a phrase whose length is unknown is expected to play, in milliseconds. */
const UNKNOWN_PHRASE_MS = 5_000;

/** The time a phrase may play beyond its length before the next one is prepared anyway. */
const PLAYBACK_SLACK_MS = 1_500;

/** How long a call waits for its browser to come back after the connection was lost. */
const RECONNECT_GRACE_MS = 20_000;

const COMPONENT = "AgentCallLive";

const RECOGNITION_FAILED: AgentCallRecognition = {
  kind: "failed",
  code: "recognition_failed",
};

/**
 * Keeps the phrases of an answer a small distance ahead of what the browser plays.
 * @remarks
 * A phrase is synthesized only once the browser confirmed the end of the
 * phrase two places before it; so one phrase plays, the next is prepared,
 * and the browser never holds more. A confirmation that does not come, for
 * example while the connection is lost, is replaced by the expected length
 * of the phrase.
 */
class PlaybackWindow {
  public bufferedPhrases = 0;
  private played = -1;
  private readonly durations = new Map<number, number>();
  private readonly waiting = new Set<() => void>();

  /**
   * Waits until a phrase may be synthesized.
   * @param index - The phrase.
   * @param signal - Ends the wait when the answer is stopped.
   */
  public async room(index: number, signal: AbortSignal): Promise<void> {
    const until = index - PHRASES_AHEAD - 1;
    if (until <= this.played || signal.aborted) return;
    const deadlineMs =
      this.expectedMs(this.played + 1, until) + PLAYBACK_SLACK_MS;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        this.waiting.delete(check);
        resolve();
      };
      const check = (): void => {
        if (this.played >= until) done();
      };
      const timer = setTimeout(done, deadlineMs);
      signal.addEventListener("abort", done, { once: true });
      this.waiting.add(check);
    });
  }

  /**
   * Counts the audio sent for a phrase, for the wait that replaces a missing confirmation.
   * @param index - The phrase.
   * @param milliseconds - The length of the block.
   */
  public addAudio(index: number, milliseconds: number): void {
    this.durations.set(index, (this.durations.get(index) ?? 0) + milliseconds);
  }

  /**
   * Notes that the browser played a phrase to its end.
   * @param index - The phrase.
   */
  public confirm(index: number): void {
    if (index <= this.played) return;
    this.played = index;
    for (const check of [...this.waiting]) check();
  }

  private expectedMs(from: number, until: number): number {
    let total = 0;
    for (let index = from; index <= until; index += 1)
      total += this.durations.get(index) ?? UNKNOWN_PHRASE_MS;
    return total;
  }
}

/** Speaks each phrase with the voice and streams its audio blocks while it is synthesized. */
function streamingSpeaker(
  speech: AgentCallLiveDependencies["speech"],
  window: PlaybackWindow,
  emit: (event: AgentCallEvent) => void,
): AgentCallSpeaker {
  return (voice) => async (phrase) => {
    await window.room(phrase.index, phrase.signal);
    if (phrase.signal.aborted) return { ok: true };
    let blocks = 0;
    let bytesPerMs = 0;
    let isBegun = false;
    const outcome = await speech.speakStream(
      {
        text: phrase.text,
        voiceId: voice?.voiceId ?? null,
        speedTenths: voice?.speedTenths ?? 10,
        signal: phrase.signal,
      },
      {
        begin: (format) => {
          isBegun = true;
          bytesPerMs = (format.sampleRate * format.channels * 2) / 1000;
          if (format.mimeType !== "audio/pcm") window.bufferedPhrases += 1;
          emit({
            type: "phrase",
            index: phrase.index,
            text: phrase.text,
            ...format,
          });
        },
        block: (audio) => {
          if (phrase.signal.aborted) return;
          if (blocks === 0) phrase.markAudio();
          if (bytesPerMs > 0)
            window.addAudio(phrase.index, audio.length / bytesPerMs);
          emit({
            type: "audio",
            index: phrase.index,
            sequence: blocks,
            audio: audio.toString("base64"),
          });
          blocks += 1;
        },
      },
    );
    // An announced phrase is always closed, even without audio, so the browser does not wait for it.
    if (isBegun && !phrase.signal.aborted)
      emit({ type: "phraseEnd", index: phrase.index, blocks });
    return outcome;
  };
}

/**
 * One live voice call of a person with an agent.
 * @remarks
 * It outlives a lost connection for a short time: the browser that comes
 * back with the same call resumes it, resends what had not been answered,
 * and the call recognizes each turn once. A turn that has ended is never
 * recognized or answered again; a repeated end answers `duplicate`.
 * Speaking again stops the running answer; audio blocks of an answer that
 * was stopped are not sent.
 */
class AgentCallLive {
  public readonly agentId: string;
  public readonly callId: string;
  private readonly person: User;
  private readonly dependencies: AgentCallLiveDependencies;
  private readonly utterances = new Map<number, LiveUtterance>();
  /** Turns whose end arrived; their audio and a repeated end are ignored. */
  private readonly ended = new Set<number>();
  /** Turns that are over; repeating them answers `duplicate`. */
  private readonly settled = new Set<number>();
  private send: AgentCallLiveSend | null = null;
  private answer: LiveAnswer | null = null;
  private isClosed = false;

  public constructor(
    person: User,
    identity: { readonly agentId: string; readonly callId: string },
    dependencies: AgentCallLiveDependencies,
  ) {
    this.person = person;
    this.agentId = identity.agentId;
    this.callId = identity.callId;
    this.dependencies = dependencies;
  }

  /** Whether a connection is attached. */
  public get isAttached(): boolean {
    return this.send !== null;
  }

  /**
   * Binds the call to a connection and tells it the readiness of the call.
   * @param send - Sends an event to this connection.
   */
  public async attach(send: AgentCallLiveSend): Promise<void> {
    this.send = send;
    const readiness = await this.dependencies.service.readiness(this.agentId);
    this.send?.({ type: "ready", readiness });
  }

  /**
   * Unbinds a connection that is gone; a newer one stays bound.
   * @param send - The sender of the connection.
   */
  public detach(send: AgentCallLiveSend): void {
    if (this.send === send) this.send = null;
  }

  /**
   * Starts an utterance and stops the answer and the utterances before it.
   * @param turn - The running number of the utterance.
   */
  public speech(turn: number): void {
    if (this.isClosed) return;
    if (this.settled.has(turn)) return this.emit(turn, { type: "duplicate" });
    // A turn that is still being answered goes on; its events reach the new connection.
    if (this.ended.has(turn)) return;
    for (const [other, utterance] of this.utterances)
      if (other < turn) this.dropUtterance(other, utterance);
    if (this.answer !== null && this.answer.turn < turn) void this.stopAnswer();
    if (this.utterances.has(turn)) return;
    this.utterances.set(turn, {
      recognizer: new AgentCallRecognizer({
        transcribe: (audio, signal) =>
          this.dependencies.recognition.transcribe({
            audio,
            mimeType: "audio/wav",
            signal,
          }),
        onPartial: (text) => this.emit(turn, { type: "partial", text }),
        now: this.dependencies.now,
      }),
      controller: new AbortController(),
    });
  }

  /**
   * Adds a block of audio to its utterance.
   * @param turn - The utterance.
   * @param sequence - The running number of the block.
   * @param pcm - 16-bit samples at 16 kHz.
   */
  public audio(turn: number, sequence: number, pcm: Buffer): void {
    const utterance = this.utterances.get(turn);
    if (utterance === undefined || this.ended.has(turn)) return;
    if (utterance.recognizer.push(sequence, pcm)) return;
    this.dropUtterance(turn, utterance);
    this.ended.add(turn);
    this.settled.add(turn);
    this.emit(turn, { type: "failed", code: "invalid" });
  }

  /**
   * Starts the recognition early, because the person paused.
   * @param turn - The utterance.
   * @param blocks - How many blocks hold the speech before the pause.
   */
  public pause(turn: number, blocks: number): void {
    this.utterances.get(turn)?.recognizer.pause(blocks);
  }

  /**
   * Drops an utterance that was too short or muted.
   * @param turn - The utterance.
   */
  public cancel(turn: number): void {
    const utterance = this.utterances.get(turn);
    if (utterance !== undefined) this.dropUtterance(turn, utterance);
  }

  /**
   * Notes that the browser played a phrase of the answer to its end.
   * @param turn - The turn of the answer.
   * @param index - The phrase.
   */
  public played(turn: number, index: number): void {
    if (this.answer?.turn === turn) this.answer.window.confirm(index);
  }

  /**
   * Marks an interrupted answer where its speech ended.
   * @param turn - The turn of the answer.
   * @param spokenCharacters - How many characters the person heard.
   */
  public async spoken(turn: number, spokenCharacters: number): Promise<void> {
    await this.dependencies.service.reportSpoken(this.person, {
      agentId: this.agentId,
      callId: this.callId,
      turn,
      spokenCharacters,
    });
  }

  /**
   * Ends an utterance: recognizes it once and answers it in the chat session.
   * @param turn - The utterance.
   * @param blocks - How many blocks were sent and how many of them hold speech.
   */
  public async end(
    turn: number,
    blocks: { readonly total: number; readonly voiced: number },
  ): Promise<void> {
    if (this.settled.has(turn)) return this.emit(turn, { type: "duplicate" });
    if (this.ended.has(turn)) return;
    const utterance = this.utterances.get(turn);
    if (utterance === undefined)
      return this.emit(turn, { type: "failed", code: "invalid" });
    this.ended.add(turn);
    try {
      await this.answerUtterance(turn, utterance, blocks);
    } finally {
      this.settled.add(turn);
    }
  }

  /** Ends the call: drops the utterances and stops the answer. */
  public async close(): Promise<void> {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const [turn, utterance] of this.utterances)
      this.dropUtterance(turn, utterance);
    this.send = null;
    await this.stopAnswer();
  }

  // The utterance stays listed while it is recognized, so speaking again drops it.
  private async answerUtterance(
    turn: number,
    utterance: LiveUtterance,
    blocks: { readonly total: number; readonly voiced: number },
  ): Promise<void> {
    const startedAt = this.dependencies.now();
    const result = await utterance.recognizer
      .finish(blocks.total, blocks.voiced, utterance.controller.signal)
      .catch((error: unknown) => {
        if (!utterance.controller.signal.aborted)
          logCaughtError(COMPONENT, error);
        return RECOGNITION_FAILED;
      });
    const isCancelled = utterance.controller.signal.aborted;
    this.dropUtterance(turn, utterance);
    if (isCancelled || this.isClosed) return;
    if (result.kind === "silent")
      return this.emit(turn, { type: "silent", reason: result.reason });
    if (result.kind === "failed")
      return this.emit(turn, { type: "failed", code: result.code });
    await this.respond(turn, {
      text: result.text,
      startedAt,
      extra: { partials: result.partials, isEarlyFinal: result.isEarly },
    });
  }

  private async respond(
    turn: number,
    input: {
      readonly text: string;
      readonly startedAt: number;
      readonly extra: Partial<AgentCallTimings>;
    },
  ): Promise<void> {
    const window = new PlaybackWindow();
    const answer: LiveAnswer = {
      turn,
      controller: new AbortController(),
      window,
    };
    this.answer = answer;
    const emit = (event: AgentCallEvent): void => {
      if (this.answer === answer || !isAnswerAudio(event))
        this.emit(turn, event);
    };
    try {
      await this.dependencies.service.transcribedTurn(
        this.person,
        {
          agentId: this.agentId,
          callId: this.callId,
          turn,
          text: input.text,
          startedAt: input.startedAt,
          signal: answer.controller.signal,
          speaker: streamingSpeaker(this.dependencies.speech, window, emit),
          extraTimings: () => ({
            ...input.extra,
            bufferedPhrases: window.bufferedPhrases,
          }),
        },
        emit,
      );
    } finally {
      if (this.answer === answer) this.answer = null;
    }
  }

  private stopAnswer(): Promise<void> {
    const answer = this.answer;
    if (answer === null) return Promise.resolve();
    this.answer = null;
    answer.controller.abort();
    return this.dependencies.service
      .stopAnswer(this.person, this.agentId)
      .catch((error: unknown) => logCaughtError(COMPONENT, error));
  }

  private dropUtterance(turn: number, utterance: LiveUtterance): void {
    utterance.controller.abort();
    utterance.recognizer.discard();
    if (this.utterances.get(turn) === utterance) this.utterances.delete(turn);
  }

  private emit(turn: number, event: AgentCallEvent): void {
    if (this.isClosed) return;
    this.send?.({ ...event, turn });
  }
}

function isAnswerAudio(event: AgentCallEvent): boolean {
  return (
    event.type === "phrase" ||
    event.type === "audio" ||
    event.type === "phraseEnd" ||
    event.type === "sentence"
  );
}

/** The handle of one connection to a live call. */
export interface AgentCallLiveHandle {
  readonly call: Pick<
    AgentCallLive,
    "speech" | "audio" | "pause" | "end" | "cancel" | "played" | "spoken"
  >;
  /** The connection is gone; the call waits a short time for the browser to come back. */
  readonly release: () => void;
  /** The person hung up: the call ends at once. */
  readonly hangup: () => Promise<void>;
}

/**
 * The live calls of all people, one per person and agent.
 * @remarks
 * A connection that names a running call resumes it; a new call of the same
 * person with the same agent ends the one before it. A call whose
 * connection is gone ends when no browser came back within
 * {@link RECONNECT_GRACE_MS}.
 */
export class AgentCallLiveCalls {
  private readonly dependencies: AgentCallLiveDependencies;
  private readonly calls = new Map<
    string,
    {
      readonly call: AgentCallLive;
      timer: ReturnType<typeof setTimeout> | null;
    }
  >();

  public constructor(dependencies: AgentCallLiveDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Opens or resumes a call for one connection.
   * @param person - The signed-in caller.
   * @param identity - The agent and the ID the browser gave the call.
   * @param send - Sends an event to this connection.
   * @returns The handle the connection steers the call with.
   */
  public async open(
    person: User,
    identity: { readonly agentId: string; readonly callId: string },
    send: AgentCallLiveSend,
  ): Promise<AgentCallLiveHandle> {
    const key = `${person.id}:${identity.agentId}`;
    let entry = this.calls.get(key);
    if (entry !== undefined && entry.call.callId !== identity.callId) {
      this.calls.delete(key);
      if (entry.timer !== null) clearTimeout(entry.timer);
      await entry.call.close();
      entry = undefined;
    }
    if (entry === undefined) {
      entry = {
        call: new AgentCallLive(person, identity, this.dependencies),
        timer: null,
      };
      this.calls.set(key, entry);
    }
    const current = entry;
    if (current.timer !== null) clearTimeout(current.timer);
    current.timer = null;
    await current.call.attach(send);
    const end = async (): Promise<void> => {
      if (this.calls.get(key) !== current) return;
      this.calls.delete(key);
      if (current.timer !== null) clearTimeout(current.timer);
      await current.call.close();
    };
    return {
      call: current.call,
      release: () => {
        current.call.detach(send);
        if (
          this.calls.get(key) !== current ||
          current.timer !== null ||
          current.call.isAttached
        )
          return;
        current.timer = setTimeout(() => {
          void end().catch((error: unknown) =>
            logCaughtError(COMPONENT, error),
          );
        }, RECONNECT_GRACE_MS);
      },
      hangup: end,
    };
  }
}
