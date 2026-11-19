import { readAudioPreferences } from "../audio-preferences";
import {
  MicrophoneError,
  openMicrophone,
  releaseStream,
} from "../audio-devices";

import {
  fetchAgentCallReadiness,
  reportSpokenAnswer,
  streamAgentTurn,
} from "./agent-call-api";
import { AgentVoicePlayer } from "./agent-voice-player";
import { SpeechDetector } from "./speech-detector";

import type { AgentCallEvent, AgentCallFailure } from "@/definition/AgentCall";
import type { CallMicrophoneState } from "../call-audio-session";

/** What the call does now, for the bar. */
export type AgentCallActivity =
  "connecting" | "listening" | "thinking" | "speaking";

/** The times of one answer, from the end of the person's speech, in milliseconds. */
export interface AgentCallLatency {
  readonly turn: number;
  /** From the end of speech to the moment the end was detected and the audio sent. */
  readonly detectionMs: number;
  /** From the end of speech to the recognized text. */
  readonly transcriptMs: number | null;
  /** From the end of speech to the first sentence that can be spoken. */
  readonly firstSentenceMs: number | null;
  /** From the end of speech to the first audible sound of the agent. */
  readonly audibleMs: number | null;
  /** What the server measured from the complete recording. */
  readonly server: {
    readonly transcriptMs: number | null;
    readonly firstSentenceMs: number | null;
    readonly firstAudioMs: number | null;
    readonly answerMs: number | null;
  } | null;
}

/** What the bar shows about a running call with an agent. */
export interface AgentCallState {
  readonly callId: string;
  readonly agentId: string;
  readonly microphone: CallMicrophoneState;
  readonly activity: AgentCallActivity;
  /** The step that failed; the call goes on unless it could not start. */
  readonly failure: AgentCallFailure | null;
  /** Whether the call has ended because it could not start. */
  readonly isFailedToStart: boolean;
  /** The saved voice is not offered by the model; the first voice speaks. */
  readonly isVoiceMissing: boolean;
  readonly latencies: readonly AgentCallLatency[];
}

/** The running answer of one turn. */
interface RunningTurn {
  readonly number: number;
  readonly controller: AbortController;
  readonly endedAt: number;
  readonly sentAt: number;
  hasSentence: boolean;
  /** The server finished the answer; only the playback may still run. */
  isDone: boolean;
  transcriptAt: number | null;
  firstSentenceAt: number | null;
  audibleAt: number | null;
  server: AgentCallLatency["server"];
}

/**
 * A voice call with an agent in the browser.
 * @remarks
 * The microphone opens only when the call starts. The speech detector cuts
 * out each utterance on the device; only a finished utterance is sent, so
 * silence, noise and a muted microphone send nothing. The answer arrives
 * sentence by sentence and plays while the rest is written. Speaking while
 * the agent answers stops the playback and the answer, and tells the server
 * how much was heard.
 */
export class AgentCallSession {
  private state: AgentCallState;
  private readonly onChange: (state: AgentCallState) => void;
  private stream: MediaStream | null = null;
  private detector: SpeechDetector | null = null;
  private player: AgentVoicePlayer | null = null;
  private running: RunningTurn | null = null;
  private turnNumber = 0;
  private isClosed = false;

  public constructor(
    agentId: string,
    onChange: (state: AgentCallState) => void,
  ) {
    this.onChange = onChange;
    this.state = {
      callId: crypto.randomUUID(),
      agentId,
      microphone: "on",
      activity: "connecting",
      failure: null,
      isFailedToStart: false,
      isVoiceMissing: false,
      latencies: [],
    };
  }

  /** Checks what the call needs, opens the microphone and starts to listen. */
  public async start(): Promise<void> {
    this.update({});
    const readiness = await fetchAgentCallReadiness(this.state.agentId);
    if (this.isClosed) return;
    if (readiness === null) return this.failToStart("agent_unavailable");
    if (readiness.recognition !== "ready")
      return this.failToStart("recognition_not_configured");
    if (readiness.synthesis !== "ready")
      return this.failToStart("synthesis_not_configured");
    try {
      this.stream = await openMicrophone(
        readAudioPreferences().microphone?.id ?? "",
      );
    } catch (error: unknown) {
      this.update({
        microphone:
          error instanceof MicrophoneError ? error.failure : "unavailable",
        activity: "listening",
        isVoiceMissing: readiness.isVoiceMissing,
      });
      return;
    }
    if (this.isClosed) return releaseStream(this.stream);
    this.listen(this.stream);
    this.update({
      activity: "listening",
      isVoiceMissing: readiness.isVoiceMissing,
    });
  }

  /**
   * Mutes or unmutes the microphone; a muted call sends nothing.
   * @param isMuted - Whether the voice must stay silent.
   */
  public setMuted(isMuted: boolean): void {
    if (this.stream === null) return;
    for (const track of this.stream.getAudioTracks()) track.enabled = !isMuted;
    this.detector?.setMuted(isMuted);
    this.update({ microphone: isMuted ? "muted" : "on" });
  }

  /** Hangs up: stops the playback and the answer and releases the microphone. */
  public close(): void {
    if (this.isClosed) return;
    this.interrupt();
    this.isClosed = true;
    this.detector?.close();
    this.detector = null;
    releaseStream(this.stream);
    this.stream = null;
  }

  private listen(stream: MediaStream): void {
    const player = new AgentVoicePlayer(
      readAudioPreferences().speaker?.id ?? "",
      {
        onAudible: () => this.handleAudible(),
        onIdle: () => this.handleIdle(),
      },
    );
    this.player = player;
    this.detector = new SpeechDetector(stream, {
      onSpeechStart: () => this.interrupt(),
      onUtterance: (audio, endedAt) => this.send(audio, endedAt),
    });
  }

  private send(audio: Blob, endedAt: number): void {
    if (this.isClosed) return;
    this.turnNumber += 1;
    const turn: RunningTurn = {
      number: this.turnNumber,
      controller: new AbortController(),
      endedAt,
      sentAt: performance.now(),
      hasSentence: false,
      isDone: false,
      transcriptAt: null,
      firstSentenceAt: null,
      audibleAt: null,
      server: null,
    };
    this.running = turn;
    this.player?.startAnswer();
    this.update({ activity: "thinking", failure: null });
    void streamAgentTurn({
      agentId: this.state.agentId,
      callId: this.state.callId,
      turn: turn.number,
      audio,
      signal: turn.controller.signal,
      onEvent: (event) => this.handleEvent(turn, event),
    });
  }

  private handleEvent(turn: RunningTurn, event: AgentCallEvent): void {
    if (this.isClosed || this.running !== turn) return;
    if (event.type === "transcript") turn.transcriptAt = performance.now();
    if (event.type === "silent" || event.type === "duplicate")
      this.finishTurn(turn, "listening");
    if (event.type === "failed") this.failTurn(turn, event.code);
    if (event.type === "sentence") {
      turn.hasSentence = true;
      turn.firstSentenceAt ??= performance.now();
      this.detector?.setAgentPlaying(true);
      this.player?.enqueue(event);
      this.update({ activity: "speaking" });
    }
    if (event.type === "done") {
      turn.server = event.timings;
      turn.isDone = true;
      const isPlaying = this.player?.isPlaying === true;
      if (!isPlaying) this.running = null;
      this.update({ activity: isPlaying ? "speaking" : "listening" });
    }
  }

  private finishTurn(turn: RunningTurn, activity: AgentCallActivity): void {
    if (this.running === turn && !turn.hasSentence) this.running = null;
    this.update({ activity });
  }

  private failTurn(turn: RunningTurn, code: AgentCallFailure): void {
    if (this.running === turn && !turn.hasSentence) this.running = null;
    this.update({
      activity: this.player?.isPlaying === true ? "speaking" : "listening",
      failure: code,
    });
  }

  private handleAudible(): void {
    const turn = this.running;
    if (turn === null || turn.audibleAt !== null) return;
    turn.audibleAt = performance.now();
    const since = (at: number | null): number | null =>
      at === null ? null : Math.round(at - turn.endedAt);
    const latency: AgentCallLatency = {
      turn: turn.number,
      detectionMs: Math.round(turn.sentAt - turn.endedAt),
      transcriptMs: since(turn.transcriptAt),
      firstSentenceMs: since(turn.firstSentenceAt),
      audibleMs: since(turn.audibleAt),
      server: turn.server,
    };
    console.info("[pages] agent call latency", latency);
    this.update({ latencies: [...this.state.latencies, latency] });
  }

  private handleIdle(): void {
    this.detector?.setAgentPlaying(false);
    if (this.running?.isDone === true) this.running = null;
    // Between two sentences of a running answer the voice is only waiting for the next one.
    if (this.running !== null) return;
    if (this.state.activity === "speaking")
      this.update({ activity: "listening" });
  }

  /** Stops what the agent says and writes, because the person speaks or hangs up. */
  private interrupt(): void {
    const turn = this.running;
    const player = this.player;
    if (turn === null && player?.isPlaying !== true) return;
    const heard = player?.stop() ?? 0;
    this.running = null;
    if (turn === null) return;
    turn.controller.abort();
    if (turn.hasSentence)
      void reportSpokenAnswer({
        agentId: this.state.agentId,
        callId: this.state.callId,
        turn: turn.number,
        spokenCharacters: heard,
      });
    if (!this.isClosed) this.update({ activity: "listening" });
  }

  private failToStart(code: AgentCallFailure): void {
    this.update({
      failure: code,
      isFailedToStart: true,
      activity: "listening",
    });
  }

  private update(change: Partial<AgentCallState>): void {
    this.state = { ...this.state, ...change };
    this.onChange(this.state);
  }
}
