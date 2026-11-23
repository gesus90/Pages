import { routeToOutput } from "../audio-devices";

import type { AgentCallPhraseEvent } from "@/definition/AgentCall";

/** A stretch in which the answer went on but nothing could be heard. */
export interface PlaybackGap {
  readonly turn: number;
  /** The phrase that should have sounded. */
  readonly index: number;
  readonly durationMs: number;
  /**
   * `block`: the next block of a playing phrase came late; `phrase`: a phrase
   * that was announced had no audio yet; `text`: the agent had not written
   * the next phrase yet. The first two are gaps of the buffer, the last a
   * pause of the answer itself.
   */
  readonly kind: "block" | "phrase" | "text";
}

/** What the player tells about the voice. */
export interface StreamPlayerEvents {
  /** The first sound of an answer is audible, at the given `performance.now()` time. */
  readonly onAudible: (turn: number, audibleAt: number) => void;
  /** A phrase was played to its end. */
  readonly onPhrasePlayed: (turn: number, index: number) => void;
  readonly onGap: (gap: PlaybackGap) => void;
  /** The answer has been played, or the playback was stopped. */
  readonly onIdle: () => void;
}

/** One phrase of the answer with the audio that arrived for it. */
interface PhraseState {
  readonly event: AgentCallPhraseEvent;
  readonly blocks: Map<number, Uint8Array<ArrayBuffer>>;
  nextSequence: number;
  /** How many blocks the phrase has; `null` until its end arrived. */
  total: number | null;
  /** Seconds of audio that arrived. */
  receivedSeconds: number;
  readonly sources: { start: number; readonly duration: number }[];
  isDecoding: boolean;
  endsAt: number;
  isReported: boolean;
}

/** The audio that waits ahead of the playback before the first sound starts, in seconds. */
const START_LEAD_SECONDS = 0.12;

/** The longest wait for that lead; a short phrase starts anyway. */
const START_WAIT_MS = 250;

/** At most this much audio is handed to the audio system ahead of the playback, in seconds. */
const MAXIMUM_AHEAD_SECONDS = 1.5;

/** The margin a block is scheduled after the current time, in seconds. */
const SCHEDULE_MARGIN_SECONDS = 0.03;

const PUMP_MS = 40;

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function pcmSeconds(bytes: number, event: AgentCallPhraseEvent): number {
  const frameBytes = Math.max(1, event.channels) * 2;
  return bytes / frameBytes / Math.max(1, event.sampleRate);
}

function isComplete(phrase: PhraseState): boolean {
  return phrase.total !== null && phrase.nextSequence >= phrase.total;
}

/**
 * Plays the answer of an agent call as it arrives, on the chosen speaker.
 * @remarks
 * Phrases play in the order of their index and blocks in the order of their
 * running number; a block that arrives twice is ignored. Streamed PCM is
 * scheduled block by block through the Web Audio API, a phrase that arrived
 * as a whole file is decoded and scheduled at once. The first sound waits for
 * a small lead of audio, and at most {@link MAXIMUM_AHEAD_SECONDS} are handed
 * to the audio system ahead of the playback; the rest waits in the phrase.
 * Stopping silences everything at once and drops the answer, so blocks that
 * still arrive for it stay mute.
 */
export class AgentStreamPlayer {
  private readonly events: StreamPlayerEvents;
  private readonly speakerId: string;
  private context: AudioContext | null = null;
  private output: AudioNode | null = null;
  private element: HTMLAudioElement | null = null;
  private turn: number | null = null;
  private readonly phrases = new Map<number, PhraseState>();
  private readonly nodes = new Set<AudioBufferSourceNode>();
  private current = 0;
  private nextTime = 0;
  private isRunning = false;
  private waitingSince: number | null = null;
  private gapStartedAt: number | null = null;
  private gapKind: PlaybackGap["kind"] = "block";
  private isAnswerDone = false;
  private hasBeenAudible = false;
  private pump: ReturnType<typeof setInterval> | null = null;

  public constructor(speakerId: string, events: StreamPlayerEvents) {
    this.speakerId = speakerId;
    this.events = events;
  }

  /** Whether an answer plays or waits for audio. */
  public get isPlaying(): boolean {
    return this.turn !== null;
  }

  /** The delay of the audio output itself, in milliseconds, where the browser tells it. */
  public get outputLatencyMs(): number {
    const latency = this.context?.outputLatency;
    return latency !== undefined && Number.isFinite(latency)
      ? latency * 1000
      : 0;
  }

  /** Opens the audio output; called once when the call starts. */
  public async prepare(): Promise<void> {
    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    const gain = context.createGain();
    this.output = gain;
    if (this.speakerId === "") gain.connect(context.destination);
    else {
      // The chosen speaker is reached through an element, the one output Pages can route everywhere.
      const destination = context.createMediaStreamDestination();
      gain.connect(destination);
      const element = new Audio();
      element.srcObject = destination.stream;
      this.element = element;
      await routeToOutput(element, this.speakerId);
      await element.play().catch((error: unknown) => {
        console.warn("Pages could not open the chosen speaker.", error);
      });
    }
    await context.resume();
  }

  /**
   * Begins a new answer; anything of an earlier one is dropped.
   * @param turn - The turn the answer belongs to.
   */
  public startAnswer(turn: number): void {
    this.silence();
    this.turn = turn;
    this.isAnswerDone = false;
    this.hasBeenAudible = false;
    this.pump = setInterval(() => this.schedule(), PUMP_MS);
  }

  /**
   * Announces a phrase.
   * @param turn - The turn of the event; another than the running answer is ignored.
   * @param event - The phrase with its format.
   */
  public phrase(turn: number, event: AgentCallPhraseEvent): void {
    if (turn !== this.turn || this.phrases.has(event.index)) return;
    this.phrases.set(event.index, {
      event,
      blocks: new Map(),
      nextSequence: 0,
      total: null,
      receivedSeconds: 0,
      sources: [],
      isDecoding: false,
      endsAt: 0,
      isReported: false,
    });
  }

  /**
   * Adds a block of audio of a phrase.
   * @param turn - The turn of the block; a late block of a stopped answer is ignored.
   * @param block - Phrase, running number and the bytes.
   */
  public audio(
    turn: number,
    block: {
      readonly index: number;
      readonly sequence: number;
      readonly audio: string;
    },
  ): void {
    const phrase = this.phrases.get(block.index);
    if (turn !== this.turn || phrase === undefined) return;
    if (
      block.sequence < phrase.nextSequence ||
      phrase.blocks.has(block.sequence)
    )
      return;
    const bytes = bytesOf(block.audio);
    phrase.blocks.set(block.sequence, bytes);
    if (phrase.event.mimeType === "audio/pcm")
      phrase.receivedSeconds += pcmSeconds(bytes.length, phrase.event);
    this.waitingSince ??= performance.now();
    this.schedule();
  }

  /**
   * Closes a phrase.
   * @param turn - The turn of the event.
   * @param index - The phrase.
   * @param blocks - How many blocks it has.
   */
  public phraseEnd(turn: number, index: number, blocks: number): void {
    const phrase = this.phrases.get(index);
    if (turn !== this.turn || phrase === undefined) return;
    phrase.total = blocks;
    this.schedule();
  }

  /**
   * Tells that no more phrases follow.
   * @param turn - The turn of the answer.
   */
  public finishAnswer(turn: number): void {
    if (turn !== this.turn) return;
    this.isAnswerDone = true;
    this.schedule();
  }

  /**
   * Stops the playback at once and drops the answer.
   * @returns How many characters of speech the person heard, a phrase that
   * was cut counted by the share that played.
   */
  public stop(): number {
    const heard = this.heard();
    const wasPlaying = this.turn !== null;
    this.silence();
    if (wasPlaying) this.events.onIdle();
    return heard;
  }

  /** Releases the audio output when the call ends. */
  public close(): void {
    this.silence();
    this.element?.pause();
    if (this.element !== null) this.element.srcObject = null;
    this.element = null;
    void this.context?.close();
    this.context = null;
  }

  private heard(): number {
    const context = this.context;
    if (context === null) return 0;
    let characters = 0;
    for (const phrase of this.phrases.values()) {
      const played = phrase.sources.reduce(
        (sum, source) =>
          sum +
          Math.min(
            source.duration,
            Math.max(0, context.currentTime - source.start),
          ),
        0,
      );
      const length = phrase.sources.reduce(
        (sum, source) => sum + source.duration,
        0,
      );
      const total = isComplete(phrase)
        ? length
        : Math.max(length, phrase.receivedSeconds);
      if (total > 0)
        characters += Math.round(
          phrase.event.text.length * Math.min(1, played / total),
        );
    }
    return characters;
  }

  private silence(): void {
    for (const node of this.nodes) {
      node.onended = null;
      node.stop();
      node.disconnect();
    }
    this.nodes.clear();
    this.phrases.clear();
    if (this.pump !== null) clearInterval(this.pump);
    this.pump = null;
    this.turn = null;
    this.current = 0;
    this.isRunning = false;
    this.waitingSince = null;
    this.gapStartedAt = null;
  }

  private schedule(): void {
    const context = this.context;
    const turn = this.turn;
    if (context === null || turn === null) return;
    this.reportPlayed(context, turn);
    if (this.isRunning && this.nextTime < context.currentTime) {
      // Everything handed over has played; until more comes the voice is silent.
      this.isRunning = false;
      this.gapStartedAt = this.nextTime;
      this.gapKind = this.waitingKind();
    }
    for (let phrase = this.phrases.get(this.current); phrase !== undefined;) {
      if (!this.feed(context, phrase)) break;
      if (!isComplete(phrase) || phrase.isDecoding) break;
      this.current += 1;
      phrase = this.phrases.get(this.current);
    }
    this.finishIfPlayed(context);
  }

  // Hands the waiting blocks of a phrase to the audio system; `false` while it has to wait.
  private feed(context: AudioContext, phrase: PhraseState): boolean {
    if (phrase.event.mimeType !== "audio/pcm")
      return this.feedFile(context, phrase);
    if (!this.isRunning && !this.isPrimed(phrase)) return false;
    for (
      let bytes = phrase.blocks.get(phrase.nextSequence);
      bytes !== undefined;
      bytes = phrase.blocks.get(phrase.nextSequence)
    ) {
      if (
        this.isRunning &&
        this.nextTime - context.currentTime > MAXIMUM_AHEAD_SECONDS
      )
        return false;
      phrase.blocks.delete(phrase.nextSequence);
      this.play(context, phrase, this.pcmBuffer(context, phrase.event, bytes));
      phrase.nextSequence += 1;
    }
    return true;
  }

  // What the silence waits for: the agent's next phrase, its first audio, or the next block.
  private waitingKind(): PlaybackGap["kind"] {
    const phrase = this.phrases.get(this.current);
    if (phrase === undefined) return "text";
    return phrase.sources.length > 0 ? "block" : "phrase";
  }

  private feedFile(context: AudioContext, phrase: PhraseState): boolean {
    if (isComplete(phrase)) return true;
    if (phrase.isDecoding) return false;
    const bytes = phrase.blocks.get(0);
    if (phrase.total === null || bytes === undefined) return false;
    phrase.isDecoding = true;
    phrase.blocks.delete(0);
    const turn = this.turn;
    void context
      .decodeAudioData(bytes.buffer)
      .then((buffer) => {
        if (this.turn !== turn) return;
        this.play(context, phrase, buffer);
      })
      .catch((error: unknown) => {
        console.warn("Pages could not decode a phrase of the answer.", error);
      })
      .finally(() => {
        phrase.isDecoding = false;
        phrase.nextSequence = phrase.total ?? 1;
        this.schedule();
      });
    return false;
  }

  // The first sound and the sound after a gap wait for a small lead, so a short delay is not heard.
  private isPrimed(phrase: PhraseState): boolean {
    let seconds = 0;
    for (
      let sequence = phrase.nextSequence;
      phrase.blocks.has(sequence);
      sequence += 1
    )
      seconds += pcmSeconds(
        phrase.blocks.get(sequence)?.length ?? 0,
        phrase.event,
      );
    if (seconds >= START_LEAD_SECONDS || phrase.total !== null) return true;
    return (
      this.waitingSince !== null &&
      performance.now() - this.waitingSince >= START_WAIT_MS
    );
  }

  private pcmBuffer(
    context: AudioContext,
    event: AgentCallPhraseEvent,
    bytes: Uint8Array<ArrayBuffer>,
  ): AudioBuffer {
    const channels = Math.max(1, event.channels);
    const samples = new Int16Array(
      bytes.buffer,
      bytes.byteOffset,
      Math.floor(bytes.length / 2),
    );
    const frames = Math.max(1, Math.floor(samples.length / channels));
    const buffer = context.createBuffer(channels, frames, event.sampleRate);
    for (let channel = 0; channel < channels; channel += 1) {
      const channelSamples = buffer.getChannelData(channel);
      for (let frame = 0; frame < frames; frame += 1)
        channelSamples[frame] =
          (samples[frame * channels + channel] ?? 0) / 0x8000;
    }
    return buffer;
  }

  private play(
    context: AudioContext,
    phrase: PhraseState,
    buffer: AudioBuffer,
  ): void {
    const turn = this.turn;
    if (turn === null || this.output === null) return;
    const start = this.startTime(context, phrase);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = phrase.event.playbackRate;
    node.connect(this.output);
    node.onended = () => {
      node.disconnect();
      this.nodes.delete(node);
    };
    node.start(start);
    this.nodes.add(node);
    const duration = buffer.duration / phrase.event.playbackRate;
    phrase.sources.push({ start, duration });
    this.nextTime = start + duration;
    phrase.endsAt = this.nextTime;
    if (!this.hasBeenAudible) {
      this.hasBeenAudible = true;
      const latency = Number.isFinite(context.outputLatency)
        ? context.outputLatency
        : 0;
      const delayMs = (start - context.currentTime + latency) * 1000;
      this.events.onAudible(turn, performance.now() + Math.max(0, delayMs));
    }
  }

  private startTime(context: AudioContext, phrase: PhraseState): number {
    if (this.isRunning) return this.nextTime;
    const start = context.currentTime + SCHEDULE_MARGIN_SECONDS;
    if (this.gapStartedAt !== null && this.turn !== null)
      this.events.onGap({
        turn: this.turn,
        index: phrase.event.index,
        durationMs: Math.round((start - this.gapStartedAt) * 1000),
        kind: this.gapKind,
      });
    this.gapStartedAt = null;
    this.waitingSince = null;
    this.isRunning = true;
    return start;
  }

  private reportPlayed(context: AudioContext, turn: number): void {
    for (const phrase of this.phrases.values()) {
      if (phrase.isReported || !isComplete(phrase) || phrase.isDecoding)
        continue;
      if (phrase.sources.length > 0 && phrase.endsAt > context.currentTime)
        continue;
      phrase.isReported = true;
      this.events.onPhrasePlayed(turn, phrase.event.index);
    }
  }

  private finishIfPlayed(context: AudioContext): void {
    if (!this.isAnswerDone || this.turn === null) return;
    const isAllPlayed = [...this.phrases.values()].every(
      (phrase) => isComplete(phrase) && !phrase.isDecoding,
    );
    if (!isAllPlayed || this.nextTime > context.currentTime) return;
    this.silence();
    this.events.onIdle();
  }
}
