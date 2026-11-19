import { routeToOutput } from "./audio-devices";
import { selectedAudioRoute } from "./call-audio-route";
import {
  CallEndedError,
  fetchIceConfiguration,
  readCallSignals,
  sendCallSignal,
} from "./call-media-api";

import type { MicrophoneFailure } from "./audio-devices";
import type { CallAudioRoute } from "./call-audio-route";
import type {
  ChatCallCandidateSignal,
  ChatCallIceConfiguration,
  ChatCallSignal,
} from "@/definition/ChatCall";

/** What the microphone of the call does: it sends, it is muted, it was lost, or it never opened. */
export type CallMicrophoneState = "on" | "muted" | "lost" | MicrophoneFailure;

/** How far the audio connection to the other person is. */
export type CallConnectionState = "connecting" | "connected" | "failed";

/** What the bar of a running call shows about its audio. */
export interface CallAudioState {
  readonly callId: string;
  readonly microphone: CallMicrophoneState;
  readonly connection: CallConnectionState;
  /** Direct or relay, once the connection chose a path. */
  readonly route: CallAudioRoute | null;
}

/** What a session of a running call is started with. */
export interface CallAudioOptions {
  readonly callId: string;
  /** The caller sends the offer, the recipient the answer. */
  readonly isCaller: boolean;
  /** The microphone the person opened for this call, or why it is missing. */
  readonly microphone:
    { readonly stream: MediaStream } | { readonly failure: MicrophoneFailure };
  /** The loudspeaker chosen when the call started; `""` is the system output. */
  readonly speakerId: string;
  readonly onChange: (state: CallAudioState) => void;
  /** The server says the call is over. */
  readonly onEnded: () => void;
}

/** How long the connection may take before the bar says it failed, in milliseconds. */
const CONNECT_TIMEOUT_MILLISECONDS = 30_000;

/** The pause before the signals are read again after a network error. */
const RETRY_MILLISECONDS = 1_500;

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function candidateSignal(candidate: RTCIceCandidate): ChatCallCandidateSignal {
  return {
    kind: "candidate",
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  };
}

function connectionConfiguration(
  ice: ChatCallIceConfiguration,
): RTCConfiguration {
  return {
    iceServers: ice.iceServers.map((server) => ({
      urls: [...server.urls],
      ...(server.username === undefined ? {} : { username: server.username }),
      ...(server.credential === undefined
        ? {}
        : { credential: server.credential }),
    })),
    iceTransportPolicy: ice.isRelayOnly ? "relay" : "all",
  };
}

/**
 * The audio connection of one running call between two browsers.
 * @remarks
 * One WebRTC connection with one audio track in each direction. The server
 * only passes the offer, the answer and the ICE candidates on; the audio runs
 * directly or over TURN. The session reads the signals for as long as it runs,
 * which also tells the server that this side is still there. It plays the
 * received voice on the loudspeaker chosen when the call started, and it never
 * stops the microphone stream it was given: whoever opened it releases it.
 */
export class CallAudioSession {
  private readonly options: CallAudioOptions;
  private readonly abort = new AbortController();
  private state: CallAudioState;
  private connection: RTCPeerConnection | null = null;
  private remoteAudio: HTMLAudioElement | null = null;
  private microphoneTrack: MediaStreamTrack | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: Promise<void> = Promise.resolve();
  private lastSequence = 0;
  private isLocalDescriptionSent = false;
  private isClosed = false;
  private readonly localCandidates: ChatCallCandidateSignal[] = [];
  private readonly remoteCandidates: RTCIceCandidateInit[] = [];
  public constructor(options: CallAudioOptions) {
    this.options = options;
    this.state = {
      callId: options.callId,
      microphone:
        "stream" in options.microphone ? "on" : options.microphone.failure,
      connection: "connecting",
      route: null,
    };
  }

  /** Builds the connection and starts to exchange signals with the other browser. */
  public start(): void {
    this.options.onChange(this.state);
    void this.run();
  }

  /**
   * Mutes or unmutes the microphone of the call; without a working microphone it does nothing.
   * @param isMuted - Whether the voice must stay silent.
   */
  public setMuted(isMuted: boolean): void {
    const track = this.microphoneTrack;
    if (track === null || track.readyState !== "live") return;
    track.enabled = !isMuted;
    this.update({ microphone: isMuted ? "muted" : "on" });
  }

  /** Ends the connection and the playback; the microphone stream stays with its owner. */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.abort.abort();
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.microphoneTrack?.removeEventListener("ended", this.onTrackEnded);
    this.connection?.close();
    if (this.remoteAudio !== null) {
      this.remoteAudio.pause();
      this.remoteAudio.srcObject = null;
    }
  }

  private readonly onTrackEnded = (): void => {
    this.handleTrackEnded();
  };

  private async run(): Promise<void> {
    try {
      const ice = await fetchIceConfiguration(this.options.callId);
      if (this.isClosed) return;
      const connection = this.createConnection(ice);
      this.addLocalAudio(connection);
      this.connectTimer = setTimeout(
        () => this.handleTimeout(),
        CONNECT_TIMEOUT_MILLISECONDS,
      );
      const listening = this.listen(connection).catch((error: unknown) => {
        this.handleFailure(error);
      });
      if (this.options.isCaller) await this.offer(connection);
      await listening;
    } catch (error: unknown) {
      this.handleFailure(error);
    }
  }

  private createConnection(ice: ChatCallIceConfiguration): RTCPeerConnection {
    const connection = new RTCPeerConnection(connectionConfiguration(ice));
    this.connection = connection;
    connection.addEventListener("icecandidate", (event) => {
      if (event.candidate) this.sendCandidate(candidateSignal(event.candidate));
    });
    connection.addEventListener("track", (event) => {
      this.playRemote(event.streams[0] ?? new MediaStream([event.track]));
    });
    connection.addEventListener("connectionstatechange", () => {
      this.handleConnectionState(connection);
    });
    return connection;
  }

  private addLocalAudio(connection: RTCPeerConnection): void {
    const { microphone } = this.options;
    if (!("stream" in microphone)) {
      this.listenOnly(connection);
      return;
    }
    const track = microphone.stream.getAudioTracks()[0];
    if (track === undefined) {
      this.listenOnly(connection);
      this.update({ microphone: "unavailable" });
      return;
    }
    this.microphoneTrack = track;
    track.addEventListener("ended", this.onTrackEnded);
    if (track.readyState === "ended") this.handleTrackEnded();
    connection.addTrack(track, microphone.stream);
  }

  /** Without a microphone this side still hears the other one. */
  private listenOnly(connection: RTCPeerConnection): void {
    if (this.options.isCaller)
      connection.addTransceiver("audio", { direction: "recvonly" });
  }

  private handleTrackEnded(): void {
    if (!this.isClosed) this.update({ microphone: "lost" });
  }

  private async offer(connection: RTCPeerConnection): Promise<void> {
    await connection.setLocalDescription(await connection.createOffer());
    this.sendDescription("offer", connection);
  }

  private async answer(
    connection: RTCPeerConnection,
    offer: string,
  ): Promise<void> {
    await connection.setRemoteDescription({ type: "offer", sdp: offer });
    await this.flushRemoteCandidates(connection);
    await connection.setLocalDescription(await connection.createAnswer());
    this.sendDescription("answer", connection);
  }

  private sendDescription(
    kind: "offer" | "answer",
    connection: RTCPeerConnection,
  ): void {
    const description = connection.localDescription?.sdp;
    if (description === undefined) return;
    this.enqueue({ kind, description });
    // Candidates follow their description, so the other side can use them at once.
    this.isLocalDescriptionSent = true;
    for (const candidate of this.localCandidates.splice(0))
      this.enqueue(candidate);
  }

  private sendCandidate(candidate: ChatCallCandidateSignal): void {
    if (this.isLocalDescriptionSent) this.enqueue(candidate);
    else this.localCandidates.push(candidate);
  }

  private enqueue(signal: ChatCallSignal): void {
    this.outbox = this.outbox
      .then(() => sendCallSignal(this.options.callId, signal))
      .catch((error: unknown) => this.handleFailure(error));
  }

  private async listen(connection: RTCPeerConnection): Promise<void> {
    while (!this.isClosed) {
      try {
        const batch = await readCallSignals(this.options.callId, {
          after: this.lastSequence,
          signal: this.abort.signal,
        });
        if (batch.isEnded) {
          this.options.onEnded();
          return;
        }
        for (const message of batch.signals) {
          this.lastSequence = Math.max(this.lastSequence, message.sequence);
          await this.receive(connection, message.signal);
        }
      } catch (error: unknown) {
        if (this.isClosed) return;
        if (error instanceof CallEndedError) throw error;
        console.warn("The call signals could not be read.", error);
        await pause(RETRY_MILLISECONDS);
      }
    }
  }

  private async receive(
    connection: RTCPeerConnection,
    signal: ChatCallSignal,
  ): Promise<void> {
    try {
      if (signal.kind === "offer" && !this.options.isCaller) {
        if (connection.remoteDescription === null)
          await this.answer(connection, signal.description);
      } else if (signal.kind === "answer" && this.options.isCaller) {
        if (connection.signalingState === "have-local-offer") {
          await connection.setRemoteDescription({
            type: "answer",
            sdp: signal.description,
          });
          await this.flushRemoteCandidates(connection);
        }
      } else if (signal.kind === "candidate") {
        await this.addCandidate(connection, signal);
      }
    } catch (error: unknown) {
      console.warn("A call signal could not be applied.", error);
      this.update({ connection: "failed" });
    }
  }

  private async addCandidate(
    connection: RTCPeerConnection,
    signal: ChatCallCandidateSignal,
  ): Promise<void> {
    if (signal.candidate === "") return;
    const candidate: RTCIceCandidateInit = {
      candidate: signal.candidate,
      sdpMid: signal.sdpMid,
      sdpMLineIndex: signal.sdpMLineIndex,
      usernameFragment: signal.usernameFragment,
    };
    if (connection.remoteDescription === null)
      this.remoteCandidates.push(candidate);
    else await connection.addIceCandidate(candidate);
  }

  private async flushRemoteCandidates(
    connection: RTCPeerConnection,
  ): Promise<void> {
    for (const candidate of this.remoteCandidates.splice(0))
      await connection.addIceCandidate(candidate);
  }

  private playRemote(stream: MediaStream): void {
    const element = this.remoteAudio ?? new Audio();
    this.remoteAudio = element;
    element.autoplay = true;
    element.srcObject = stream;
    void this.startPlayback(element);
  }

  private async startPlayback(element: HTMLAudioElement): Promise<void> {
    // The call and the test tone use the same chosen output; a missing one
    // leaves the voice on the system output.
    await routeToOutput(element, this.options.speakerId);
    try {
      await element.play();
    } catch (error: unknown) {
      console.warn("The voice of the call could not start playing.", error);
    }
  }

  private handleConnectionState(connection: RTCPeerConnection): void {
    if (this.isClosed) return;
    const { connectionState } = connection;
    if (connectionState === "connected") {
      this.update({ connection: "connected" });
      void this.detectRoute(connection);
    } else if (connectionState === "failed") {
      this.update({ connection: "failed" });
    } else if (connectionState !== "closed") {
      this.update({ connection: "connecting" });
    }
  }

  private async detectRoute(connection: RTCPeerConnection): Promise<void> {
    try {
      const route = selectedAudioRoute(await connection.getStats());
      if (route === null || this.isClosed) return;
      this.update({ route });
      console.info(`The audio of the call runs over a ${route} connection.`);
    } catch (error: unknown) {
      console.warn("The audio route of the call could not be read.", error);
    }
  }

  private handleTimeout(): void {
    if (this.isClosed || this.state.connection === "connected") return;
    this.update({ connection: "failed" });
  }

  private handleFailure(error: unknown): void {
    if (this.isClosed) return;
    if (error instanceof CallEndedError) {
      this.options.onEnded();
      return;
    }
    console.warn("The audio connection of the call failed.", error);
    this.update({ connection: "failed" });
  }

  private update(change: Partial<CallAudioState>): void {
    this.state = { ...this.state, ...change };
    if (!this.isClosed) this.options.onChange(this.state);
  }
}
