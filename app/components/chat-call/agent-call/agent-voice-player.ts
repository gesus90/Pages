import { routeToOutput } from "../audio-devices";

/** One sentence of the answer with its audio. */
export interface VoiceSentence {
  readonly index: number;
  readonly text: string;
  readonly mimeType: string;
  /** The audio, base64 encoded. */
  readonly audio: string;
  readonly playbackRate: number;
}

/** What the player tells about the voice. */
export interface VoicePlayerEvents {
  /** The first sound of an answer is audible. */
  readonly onAudible: () => void;
  /** Everything queued has been played, or the playback was stopped. */
  readonly onIdle: () => void;
}

function bytesOf(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Plays the sentences of an answer one after another on the chosen speaker.
 * @remarks
 * A sentence starts as soon as it arrives and the one before it is over, so
 * the voice speaks while the rest of the answer is still written. Stopping
 * discards the sentence that plays and every one that waits, and tells how
 * many characters of speech were heard.
 */
export class AgentVoicePlayer {
  private readonly events: VoicePlayerEvents;
  private readonly speakerId: string;
  private readonly queue: VoiceSentence[] = [];
  private current: {
    readonly sentence: VoiceSentence;
    readonly element: HTMLAudioElement;
    readonly url: string;
  } | null = null;
  private heardCharacters = 0;
  private hasBeenAudible = false;

  public constructor(speakerId: string, events: VoicePlayerEvents) {
    this.speakerId = speakerId;
    this.events = events;
  }

  /** Whether a sentence plays or waits. */
  public get isPlaying(): boolean {
    return this.current !== null || this.queue.length > 0;
  }

  /**
   * Adds a sentence; it plays when the ones before it are over.
   * @param sentence - The sentence with its audio.
   */
  public enqueue(sentence: VoiceSentence): void {
    this.queue.push(sentence);
    if (this.current === null) void this.playNext();
  }

  /**
   * Stops the playback and drops what waits.
   * @returns How many characters of speech the person heard, the sentence that
   * was cut counted by the share that played.
   */
  public stop(): number {
    this.queue.length = 0;
    const heard = this.heardCharacters + this.partialCharacters();
    this.release();
    this.heardCharacters = 0;
    this.hasBeenAudible = false;
    this.events.onIdle();
    return heard;
  }

  /** Forgets what was heard, for the next answer. */
  public startAnswer(): void {
    this.heardCharacters = 0;
    this.hasBeenAudible = false;
  }

  /** How many characters of speech have been heard so far. */
  public get heard(): number {
    return this.heardCharacters + this.partialCharacters();
  }

  private partialCharacters(): number {
    const current = this.current;
    if (current === null) return 0;
    const { element, sentence } = current;
    if (!Number.isFinite(element.duration) || element.duration <= 0) return 0;
    const share = Math.min(1, element.currentTime / element.duration);
    return Math.round(sentence.text.length * share);
  }

  private release(): void {
    const current = this.current;
    this.current = null;
    if (current === null) return;
    current.element.pause();
    current.element.removeAttribute("src");
    current.element.load();
    URL.revokeObjectURL(current.url);
  }

  private async playNext(): Promise<void> {
    const sentence = this.queue.shift();
    if (sentence === undefined) {
      this.events.onIdle();
      return;
    }
    const url = URL.createObjectURL(
      new Blob([bytesOf(sentence.audio)], { type: sentence.mimeType }),
    );
    const element = new Audio(url);
    element.playbackRate = sentence.playbackRate;
    this.current = { sentence, element, url };
    element.onended = () => this.finishSentence(element, true);
    element.onerror = () => this.finishSentence(element, false);
    element.onplaying = () => this.noteAudible();
    await routeToOutput(element, this.speakerId);
    if (this.current?.element !== element) return;
    try {
      await element.play();
    } catch (error: unknown) {
      // The browser refused the playback, such as an autoplay block; skip the sentence.
      console.warn("Pages could not play a sentence of the answer.", error);
      this.finishSentence(element, false);
    }
  }

  private noteAudible(): void {
    if (this.hasBeenAudible) return;
    this.hasBeenAudible = true;
    this.events.onAudible();
  }

  private finishSentence(element: HTMLAudioElement, wasHeard: boolean): void {
    const current = this.current;
    if (current?.element !== element) return;
    if (wasHeard) this.heardCharacters += current.sentence.text.length;
    this.release();
    void this.playNext();
  }
}
