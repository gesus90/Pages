import { reportSpokenAnswer } from "./agent-call-api";
import { AgentCallSocket } from "./agent-call-socket";
import { AgentStreamPlayer } from "./agent-stream-player";
import { SpeechDetector } from "./speech-detector";

import type {
  AgentCallFailure,
  AgentCallLiveCommand,
  AgentCallLiveEvent,
  AgentCallTimings,
} from "@/definition/AgentCall";
import type {
  AgentCallInterruption,
  AgentCallLatency,
  AgentCallState,
} from "./agent-call-session";
import type { PlaybackGap } from "./agent-stream-player";
import type { SpeechEnding } from "./speech-detector";

/** What the live path needs from its call. */
export interface AgentLiveCallOptions {
  readonly agentId: string;
  readonly callId: string;
  readonly speakerId: string;
  readonly update: (change: Partial<AgentCallState>) => void;
  readonly read: () => AgentCallState;
  /** The connection is gone for good; the call goes on buffered after the last turn it used. */
  readonly onLost: (lastTurn: number) => void;
}

/** An utterance that is kept until the server has settled it, so it can be sent again. */
interface PendingUtterance {
  readonly turn: number;
  readonly blocks: Int16Array[];
  readonly startedAt: number;
  pauseBlocks: number | null;
  ending: { readonly blocks: number; readonly voicedBlocks: number } | null;
}

/** The turn the call waits for or plays. */
interface LiveTurn {
  readonly number: number;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly sentAt: number;
  transcriptAt: number | null;
  firstPhraseAt: number | null;
  firstAudioAt: number | null;
  hasPhrase: boolean;
  isDone: boolean;
  server: AgentCallTimings | null;
}

/** The longest utterance that is sent: 60 seconds of blocks of about 43 milliseconds. */
const MAXIMUM_BLOCKS = 1_500;

/** How long the start waits for the server to open the call. */
const OPEN_DEADLINE_MS = 6_000;

/** How many gaps and interruptions the state keeps for the check of a call. */
const KEPT_MEASUREMENTS = 200;

/** The time from an origin to a moment, or `null` while the moment has not come. */
function since(at: number | null, origin: number): number | null {
  return at === null ? null : Math.round(at - origin);
}

/**
 * The live path of a voice call with an agent.
 * @remarks
 * While the person speaks, every block of the utterance goes over one open
 * WebSocket and the server answers preliminary transcripts. The end of the
 * speech, found on the device, ends the utterance; the server confirms one
 * final transcript and starts exactly one turn, whose answer arrives phrase
 * by phrase in audio blocks and plays while it is synthesized. Speaking
 * again silences the answer at once and drops every late block of it. A
 * lost connection is opened again, and the utterance that was not settled
 * yet is sent again; the server recognizes and answers it only once.
 */
export class AgentLiveCall {
  private readonly options: AgentLiveCallOptions;
  private readonly socket: AgentCallSocket;
  private readonly player: AgentStreamPlayer;
  private detector: SpeechDetector | null = null;
  private pending: PendingUtterance | null = null;
  private running: LiveTurn | null = null;
  /** When the first preliminary transcript of each unfinished turn arrived. */
  private readonly firstPartials = new Map<number, number>();
  private turnNumber = 0;
  private isClosed = false;
  private resolveOpen: ((isOpen: boolean) => void) | null = null;

  public constructor(options: AgentLiveCallOptions) {
    this.options = options;
    this.socket = new AgentCallSocket({
      onOpen: () =>
        this.send({
          type: "hello",
          agentId: options.agentId,
          callId: options.callId,
        }),
      onEvent: (event) => this.handleEvent(event),
      onInterrupted: () =>
        console.warn(
          "Pages lost the connection of the call and opens it again.",
        ),
      onLost: () => this.handleLost(),
    });
    this.player = new AgentStreamPlayer(options.speakerId, {
      onAudible: (turn, at) => this.handleAudible(turn, at),
      onPhrasePlayed: (turn, index) =>
        this.send({ type: "played", turn, index }),
      onGap: (gap) => this.handleGap(gap),
      onIdle: () => this.handleIdle(),
    });
  }

  /**
   * Opens the connection and the voice, then listens.
   * @param stream - The opened microphone.
   * @returns `false` when the live path could not open; nothing of it is left running.
   */
  public async start(stream: MediaStream): Promise<boolean> {
    const isOpen = await new Promise<boolean>((resolve) => {
      const deadline = setTimeout(() => resolve(false), OPEN_DEADLINE_MS);
      this.resolveOpen = (value) => {
        clearTimeout(deadline);
        resolve(value);
      };
      this.socket.connect();
    });
    this.resolveOpen = null;
    if (!isOpen || this.isClosed) {
      this.release();
      return false;
    }
    await this.player.prepare();
    this.detector = new SpeechDetector(stream, {
      onSpeechStart: () => this.beginUtterance(),
      onBlock: (samples) => this.sendBlock(samples),
      onPause: (trailing) => this.pause(trailing),
      onEnd: (ending) => this.endUtterance(ending),
    });
    return true;
  }

  /**
   * Mutes or unmutes the detection; a muted call sends nothing.
   * @param isMuted - Whether the voice must stay silent.
   */
  public setMuted(isMuted: boolean): void {
    this.detector?.setMuted(isMuted);
  }

  /** Hangs up: ends the call on the server, the playback and the recording. */
  public close(): void {
    if (this.isClosed) return;
    this.interrupt();
    this.isClosed = true;
    this.send({ type: "hangup" });
    this.resolveOpen?.(false);
    this.release();
  }

  private release(): void {
    this.detector?.close();
    this.detector = null;
    this.player.close();
    this.socket.close();
  }

  private send(command: AgentCallLiveCommand): boolean {
    return this.socket.send(command);
  }

  private beginUtterance(): void {
    this.interrupt();
    this.turnNumber += 1;
    this.pending = {
      turn: this.turnNumber,
      blocks: [],
      startedAt: performance.now(),
      pauseBlocks: null,
      ending: null,
    };
    this.send({ type: "speech", turn: this.turnNumber });
  }

  private sendBlock(samples: Int16Array): void {
    const pending = this.pending;
    if (pending === null || pending.ending !== null) return;
    if (pending.blocks.length >= MAXIMUM_BLOCKS) return;
    pending.blocks.push(samples);
    this.socket.sendAudio(pending.turn, pending.blocks.length - 1, samples);
  }

  private pause(trailingBlocks: number): void {
    const pending = this.pending;
    if (pending === null || pending.ending !== null) return;
    pending.pauseBlocks = Math.max(0, pending.blocks.length - trailingBlocks);
    this.send({
      type: "quiet",
      turn: pending.turn,
      blocks: pending.pauseBlocks,
    });
  }

  private endUtterance(ending: SpeechEnding): void {
    const pending = this.pending;
    if (pending === null || pending.ending !== null) return;
    if (!ending.isKept) {
      this.send({ type: "cancel", turn: pending.turn });
      this.pending = null;
      this.options.update({ partial: null });
      return;
    }
    const blocks = pending.blocks.length;
    pending.ending = {
      blocks,
      voicedBlocks: Math.max(1, blocks - ending.trailingBlocks),
    };
    this.send({ type: "end", turn: pending.turn, ...pending.ending });
    this.running = {
      number: pending.turn,
      startedAt: pending.startedAt,
      endedAt: ending.endedAt,
      sentAt: performance.now(),
      transcriptAt: null,
      firstPhraseAt: null,
      firstAudioAt: null,
      hasPhrase: false,
      isDone: false,
      server: null,
    };
    this.player.startAnswer(pending.turn);
    this.options.update({ activity: "thinking", failure: null });
  }

  // After a lost connection the unsettled utterance is sent again; the server keeps it once.
  private resend(): void {
    const pending = this.pending;
    if (pending === null) return;
    this.send({ type: "speech", turn: pending.turn });
    pending.blocks.forEach((samples, sequence) =>
      this.socket.sendAudio(pending.turn, sequence, samples),
    );
    if (pending.pauseBlocks !== null)
      this.send({
        type: "quiet",
        turn: pending.turn,
        blocks: pending.pauseBlocks,
      });
    if (pending.ending !== null)
      this.send({ type: "end", turn: pending.turn, ...pending.ending });
  }

  private handleEvent(event: AgentCallLiveEvent): void {
    if (this.isClosed) return;
    if (event.type === "ready") {
      if (this.resolveOpen !== null) this.resolveOpen(true);
      else this.resend();
      return;
    }
    if (event.type === "closed") {
      this.resolveOpen?.(false);
      return;
    }
    if (event.type === "partial")
      return this.handlePartial(event.turn, event.text);
    const turn = this.running?.number === event.turn ? this.running : null;
    if (event.type === "transcript")
      return this.handleTranscript(event.turn, turn);
    if (event.type === "silent" || event.type === "duplicate")
      return this.settle(event.turn, null);
    if (event.type === "failed") return this.settle(event.turn, event.code);
    // Blocks of an answer that was stopped find no running turn and stay mute.
    if (turn !== null) this.handleAnswer(turn, event);
  }

  private handleAnswer(turn: LiveTurn, event: AgentCallLiveEvent): void {
    if (event.type === "phrase") {
      turn.hasPhrase = true;
      turn.firstPhraseAt ??= performance.now();
      this.detector?.setAgentPlaying(true);
      this.player.phrase(event.turn, event);
      this.options.update({ activity: "speaking" });
    }
    if (event.type === "audio") {
      turn.firstAudioAt ??= performance.now();
      this.player.audio(event.turn, event);
    }
    if (event.type === "phraseEnd")
      this.player.phraseEnd(event.turn, event.index, event.blocks);
    if (event.type === "done") {
      turn.server = event.timings;
      turn.isDone = true;
      this.player.finishAnswer(event.turn);
    }
  }

  private handlePartial(turn: number, text: string): void {
    const isCurrent =
      this.pending?.turn === turn || this.running?.number === turn;
    if (!isCurrent) return;
    if (!this.firstPartials.has(turn))
      this.firstPartials.set(turn, performance.now());
    this.options.update({ partial: text });
  }

  private handleTranscript(turnNumber: number, turn: LiveTurn | null): void {
    if (this.pending?.turn === turnNumber) this.pending = null;
    if (turn === null || turn.transcriptAt !== null) return;
    turn.transcriptAt = performance.now();
    this.options.update({ partial: null });
  }

  // The server settled the turn without an answer, or the answer failed.
  private settle(turnNumber: number, failure: AgentCallFailure | null): void {
    if (this.pending?.turn === turnNumber) this.pending = null;
    this.firstPartials.delete(turnNumber);
    const turn = this.running;
    if (turn?.number !== turnNumber) return;
    this.player.finishAnswer(turnNumber);
    if (!turn.hasPhrase) {
      this.running = null;
      this.player.stop();
    }
    this.options.update({
      activity: this.player.isPlaying ? "speaking" : "listening",
      partial: null,
      ...(failure === null ? {} : { failure }),
    });
  }

  private handleAudible(turnNumber: number, audibleAt: number): void {
    const turn = this.running;
    if (turn?.number !== turnNumber) return;
    const origin = turn.endedAt;
    const firstPartialAt = this.firstPartials.get(turnNumber) ?? null;
    const latency: AgentCallLatency = {
      turn: turn.number,
      transport: "live",
      isWarm: turn.number > 1,
      detectionMs: Math.round(turn.sentAt - origin),
      transcriptMs: since(turn.transcriptAt, origin),
      firstSentenceMs: since(turn.firstPhraseAt, origin),
      firstAudioMs: since(turn.firstAudioAt, origin),
      audibleMs: since(audibleAt, origin),
      firstPartialMs: since(firstPartialAt, origin),
      firstBlockMs: Math.round(turn.startedAt - origin),
      server: turn.server,
    };
    this.firstPartials.delete(turnNumber);
    this.addLatency(latency);
  }

  private addLatency(latency: AgentCallLatency): void {
    const state = this.options.read();
    this.options.update({
      latencies: [...state.latencies, latency].slice(-KEPT_MEASUREMENTS),
    });
  }

  private handleGap(gap: PlaybackGap): void {
    console.info("[pages] agent call playback gap", gap);
    const state = this.options.read();
    this.options.update({
      gaps: [...state.gaps, gap].slice(-KEPT_MEASUREMENTS),
    });
  }

  private handleIdle(): void {
    this.detector?.setAgentPlaying(false);
    const turn = this.running;
    if (turn !== null && (turn.isDone || !turn.hasPhrase)) {
      // The server times arrive with the end; they are added to the turn's measurement.
      this.completeLatency(turn);
      this.running = null;
    }
    if (this.running !== null) return;
    if (this.options.read().activity === "speaking")
      this.options.update({ activity: "listening" });
  }

  private completeLatency(turn: LiveTurn): void {
    if (turn.server === null) return;
    const state = this.options.read();
    const latencies = state.latencies.map((latency) =>
      latency.turn === turn.number && latency.transport === "live"
        ? { ...latency, server: turn.server }
        : latency,
    );
    this.options.update({ latencies });
  }

  /** Stops what the agent says and writes, because the person speaks or hangs up. */
  private interrupt(): void {
    const turn = this.running;
    if (turn === null && !this.player.isPlaying) return;
    const detectedAt = performance.now();
    const heard = this.player.stop();
    // The last sound leaves the speaker once the output's own delay has passed.
    const stopMs = performance.now() - detectedAt + this.player.outputLatencyMs;
    this.running = null;
    if (turn === null) return;
    this.firstPartials.delete(turn.number);
    if (turn.hasPhrase) {
      const report: AgentCallLiveCommand = {
        type: "spoken",
        turn: turn.number,
        spokenCharacters: heard,
      };
      if (!this.send(report))
        void reportSpokenAnswer({
          agentId: this.options.agentId,
          callId: this.options.callId,
          turn: turn.number,
          spokenCharacters: heard,
        });
      const interruption: AgentCallInterruption = {
        turn: turn.number,
        stopMs: Math.round(stopMs),
        heardCharacters: heard,
      };
      console.info("[pages] agent call interruption", interruption);
      const state = this.options.read();
      this.options.update({
        interruptions: [...state.interruptions, interruption].slice(
          -KEPT_MEASUREMENTS,
        ),
      });
    }
    if (!this.isClosed)
      this.options.update({ activity: "listening", partial: null });
  }

  private handleLost(): void {
    this.resolveOpen?.(false);
    if (this.isClosed || this.detector === null) return;
    this.interrupt();
    this.isClosed = true;
    this.release();
    this.options.onLost(this.turnNumber);
  }
}
