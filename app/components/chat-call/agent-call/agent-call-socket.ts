import {
  AGENT_CALL_AUDIO_HEADER_BYTES,
  AGENT_CALL_SOCKET_PATH,
} from "@/definition/AgentCall";

import type {
  AgentCallLiveCommand,
  AgentCallLiveEvent,
} from "@/definition/AgentCall";

/** What the socket tells the call. */
export interface AgentCallSocketEvents {
  /** The connection is open; `isReconnect` after it was lost before. */
  readonly onOpen: (isReconnect: boolean) => void;
  readonly onEvent: (event: AgentCallLiveEvent) => void;
  /** The connection broke; it is opened again. */
  readonly onInterrupted: () => void;
  /** The connection could not be opened or came not back; the call cannot go on live. */
  readonly onLost: (wasEverOpen: boolean) => void;
}

/** The waits before each new attempt after the connection broke, in milliseconds. */
const RECONNECT_DELAYS_MS: readonly number[] = [250, 500, 1_000, 2_000, 4_000];

function socketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}${AGENT_CALL_SOCKET_PATH}`;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLiveEvent(value: unknown): value is AgentCallLiveEvent {
  return isRecord(value) && typeof value.type === "string";
}

/**
 * The open connection of a live agent call.
 * @remarks
 * Commands go as JSON, audio blocks as binary frames with the turn and the
 * running number in front of the samples. A broken connection is opened
 * again a few times with growing waits; what was sent while it was closed is
 * lost, so the call resends what has not been answered when it is back.
 */
export class AgentCallSocket {
  private readonly events: AgentCallSocketEvents;
  private socket: WebSocket | null = null;
  private attempt = 0;
  private wasEverOpen = false;
  private isClosed = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  public constructor(events: AgentCallSocketEvents) {
    this.events = events;
  }

  /** Whether commands and audio can be sent now. */
  public get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Opens the connection. */
  public connect(): void {
    if (this.isClosed) return;
    const socket = new WebSocket(socketUrl());
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.onopen = () => {
      const isReconnect = this.wasEverOpen;
      this.wasEverOpen = true;
      this.attempt = 0;
      this.events.onOpen(isReconnect);
    };
    socket.onmessage = (message) => this.receive(message.data);
    socket.onclose = () => this.handleClose(socket);
  }

  /**
   * Sends a command.
   * @param command - The command.
   * @returns `false` while the connection is closed.
   */
  public send(command: AgentCallLiveCommand): boolean {
    if (!this.isOpen) return false;
    this.socket?.send(JSON.stringify(command));
    return true;
  }

  /**
   * Sends one block of audio.
   * @param turn - The utterance it belongs to.
   * @param sequence - Its running number in the utterance, from 0.
   * @param samples - 16-bit samples at 16 kHz.
   * @returns `false` while the connection is closed.
   */
  public sendAudio(
    turn: number,
    sequence: number,
    samples: Int16Array,
  ): boolean {
    if (!this.isOpen) return false;
    const frame = new ArrayBuffer(
      AGENT_CALL_AUDIO_HEADER_BYTES + samples.byteLength,
    );
    const view = new DataView(frame);
    view.setUint32(0, turn, true);
    view.setUint32(4, sequence, true);
    for (let index = 0; index < samples.length; index += 1)
      view.setInt16(
        AGENT_CALL_AUDIO_HEADER_BYTES + index * 2,
        samples[index],
        true,
      );
    this.socket?.send(frame);
    return true;
  }

  /** Closes the connection for good. */
  public close(): void {
    this.isClosed = true;
    if (this.retry !== null) clearTimeout(this.retry);
    this.retry = null;
    const socket = this.socket;
    this.socket = null;
    if (socket === null) return;
    socket.onclose = null;
    socket.onmessage = null;
    socket.close(1000, "hangup");
  }

  private receive(messageText: unknown): void {
    if (typeof messageText !== "string") return;
    try {
      const parsed: unknown = JSON.parse(messageText);
      if (isLiveEvent(parsed)) this.events.onEvent(parsed);
    } catch (error: unknown) {
      console.warn("Pages received an unreadable call event.", error);
    }
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket || this.isClosed) return;
    this.socket = null;
    const delay = RECONNECT_DELAYS_MS[this.attempt];
    if (!this.wasEverOpen || delay === undefined) {
      this.isClosed = true;
      this.events.onLost(this.wasEverOpen);
      return;
    }
    this.attempt += 1;
    this.events.onInterrupted();
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, delay);
  }
}
