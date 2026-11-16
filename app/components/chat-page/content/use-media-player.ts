import { useEffect, useRef, useState } from "react";

import {
  claimPlayback,
  positionOf,
  registerMedia,
  releasePlayback,
  savePosition,
  takeOver,
  unregisterMedia,
} from "./media-session";

import type { MediaHandle } from "./media-session";

/** The speeds a player steps through, in this order. */
const SPEEDS: readonly number[] = [1, 1.5, 2, 0.5];

/**
 * The speed after the given one: 1× → 1,5× → 2× → 0,5× → 1×.
 * @param speed - The current speed.
 * @returns The next speed; 1× for an unknown one.
 */
export function nextMediaSpeed(speed: number): number {
  const index = SPEEDS.indexOf(speed);
  return index < 0 ? 1 : (SPEEDS[(index + 1) % SPEEDS.length] ?? 1);
}

/** What the element read of the file once its metadata arrived. */
export interface MediaMetadata {
  readonly durationSeconds: number;
  /** Pixels of a video; 0 for a sound. */
  readonly width: number;
  readonly height: number;
}

/** Playing, the position, the length and the speed of one video or audio element. */
export interface MediaPlayer<TElement extends HTMLMediaElement> {
  readonly media: React.RefObject<TElement | null>;
  readonly isPlaying: boolean;
  /** Whether the file was ever started in this view; the original loads from then on. */
  readonly hasStarted: boolean;
  readonly positionSeconds: number;
  /** The length; `null` until the element knows it. */
  readonly durationSeconds: number | null;
  /** The played part, from 0 to 1. */
  readonly share: number;
  /** The part loaded so far from the start, from 0 to 1. */
  readonly bufferedShare: number;
  readonly speed: number;
  readonly isMuted: boolean;
  toggle(): void;
  /** Jumps to a part of the length, from 0 to 1; nothing before the length is known. */
  seek(share: number): void;
  /** Moves by seconds, forward or back, within the length. */
  skip(seconds: number): void;
  /** Steps to the next speed: 1× → 1,5× → 2× → 0,5×. */
  nextSpeed(): void;
  /** Switches the sound off and on. */
  toggleMute(): void;
  readonly events: Pick<
    React.MediaHTMLAttributes<TElement>,
    | "onPlay"
    | "onPause"
    | "onEnded"
    | "onTimeUpdate"
    | "onDurationChange"
    | "onProgress"
    | "onVolumeChange"
    | "onLoadedMetadata"
  >;
}

/** Options of a player of the chat. */
export interface MediaPlayerOptions {
  /**
   * The file the player plays; with it the player joins the one playback of
   * the page: it starts where the file stopped and pauses every other medium
   * when it starts.
   */
  readonly attachmentId?: string;
  /**
   * The view opened from another one, as the split view or the full screen:
   * it takes the file over from the other views of it and plays on when they
   * played.
   */
  readonly isTakingOver?: boolean;
  /** Called once the element read the length and size of the file. */
  readonly onMetadata?: (metadata: MediaMetadata) => void;
}

function bufferedEnd(element: HTMLMediaElement): number {
  const { buffered } = element;
  return buffered.length === 0 ? 0 : buffered.end(buffered.length - 1);
}

/** Joins the element to the one playback of the page while the player is shown. */
function useMediaSession(
  media: React.RefObject<HTMLMediaElement | null>,
  options: MediaPlayerOptions,
  setPosition: (seconds: number) => void,
): React.RefObject<MediaHandle | null> {
  const handle = useRef<MediaHandle | null>(null);
  const { attachmentId, isTakingOver = false } = options;
  useEffect(() => {
    if (attachmentId === undefined) return undefined;
    const registered = registerMedia(attachmentId, () => media.current);
    handle.current = registered;
    const handover = isTakingOver
      ? takeOver(registered)
      : { positionSeconds: positionOf(attachmentId), isPlaying: false };
    const element = media.current;
    if (element && handover.positionSeconds > 0) {
      // Before the original loads this sets where it starts, without loading it.
      element.currentTime = handover.positionSeconds;
      setPosition(handover.positionSeconds);
    }
    if (element && handover.isPlaying)
      void element.play().catch(() => undefined);
    return () => {
      handle.current = null;
      unregisterMedia(registered);
    };
  }, [attachmentId, isTakingOver, media, setPosition]);
  return handle;
}

interface BuildMediaEventsInput {
  readonly attachmentId: string | undefined;
  readonly onMetadata: MediaPlayerOptions["onMetadata"];
  readonly session: React.RefObject<MediaHandle | null>;
  readonly setPlaying: (playing: boolean) => void;
  readonly setStarted: (started: boolean) => void;
  readonly setPosition: (seconds: number) => void;
  readonly setDuration: (seconds: number | null) => void;
  readonly setBuffered: (seconds: number) => void;
  readonly setMuted: (muted: boolean) => void;
}

function buildMediaEvents<TElement extends HTMLMediaElement>({
  attachmentId,
  onMetadata,
  session,
  setPlaying,
  setStarted,
  setPosition,
  setDuration,
  setBuffered,
  setMuted,
}: BuildMediaEventsInput): MediaPlayer<TElement>["events"] {
  return {
    onPlay: () => {
      setPlaying(true);
      setStarted(true);
      if (session.current) claimPlayback(session.current);
    },
    onPause: () => {
      setPlaying(false);
      if (session.current) releasePlayback(session.current);
    },
    onEnded: () => {
      setPlaying(false);
      if (session.current) releasePlayback(session.current);
    },
    onTimeUpdate: (event) => {
      const { currentTime } = event.currentTarget;
      setPosition(currentTime);
      if (attachmentId !== undefined) savePosition(attachmentId, currentTime);
    },
    onDurationChange: (event) => {
      const { duration } = event.currentTarget;
      setDuration(Number.isFinite(duration) ? duration : null);
    },
    onProgress: (event) => setBuffered(bufferedEnd(event.currentTarget)),
    onVolumeChange: (event) => setMuted(event.currentTarget.muted),
    onLoadedMetadata: (event) => {
      const element = event.currentTarget;
      if (!onMetadata || !Number.isFinite(element.duration)) return;
      onMetadata({
        durationSeconds: element.duration,
        width: element instanceof HTMLVideoElement ? element.videoWidth : 0,
        height: element instanceof HTMLVideoElement ? element.videoHeight : 0,
      });
    },
  };
}

/**
 * The state of an own player around a `<video>` or `<audio>` element:
 * give `media` as its ref and spread `events` onto it.
 * @param options - The file, whether the view takes it over, and the reader
 * of its metadata.
 * @returns The state and the actions of the player.
 */
export function useMediaPlayer<TElement extends HTMLMediaElement>(
  options: MediaPlayerOptions = {},
): MediaPlayer<TElement> {
  const media = useRef<TElement | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [hasStarted, setStarted] = useState(false);
  const [positionSeconds, setPosition] = useState(0);
  const [durationSeconds, setDuration] = useState<number | null>(null);
  const [bufferedSeconds, setBuffered] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [isMuted, setMuted] = useState(false);
  const session = useMediaSession(media, options, setPosition);
  const { attachmentId, onMetadata } = options;

  function toggle(): void {
    const element = media.current;
    if (!element) return;
    if (!element.paused) {
      element.pause();
      return;
    }
    // A new load resets the speed of the element.
    element.playbackRate = speed;
    void element.play().catch(() => setPlaying(false));
  }

  function moveTo(target: number): void {
    const element = media.current;
    if (!element) return;
    element.currentTime = target;
    setPosition(target);
    if (attachmentId !== undefined) savePosition(attachmentId, target);
  }

  function seek(share: number): void {
    if (durationSeconds === null) return;
    moveTo(Math.min(1, Math.max(0, share)) * durationSeconds);
  }

  function skip(seconds: number): void {
    const element = media.current;
    if (!element) return;
    const end = durationSeconds ?? Number.POSITIVE_INFINITY;
    moveTo(Math.min(end, Math.max(0, element.currentTime + seconds)));
  }

  function nextSpeed(): void {
    const next = nextMediaSpeed(speed);
    setSpeed(next);
    if (media.current) media.current.playbackRate = next;
  }

  function toggleMute(): void {
    const element = media.current;
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
  }

  const share =
    durationSeconds === null || durationSeconds <= 0
      ? 0
      : Math.min(1, positionSeconds / durationSeconds);
  const bufferedShare =
    durationSeconds === null || durationSeconds <= 0
      ? 0
      : Math.min(1, bufferedSeconds / durationSeconds);

  return {
    media,
    isPlaying,
    hasStarted,
    positionSeconds,
    durationSeconds,
    share,
    bufferedShare,
    speed,
    isMuted,
    toggle,
    seek,
    skip,
    nextSpeed,
    toggleMute,
    events: buildMediaEvents({
      attachmentId,
      onMetadata,
      session,
      setPlaying,
      setStarted,
      setPosition,
      setDuration,
      setBuffered,
      setMuted,
    }),
  };
}

/**
 * Joins a player of its own, such as a voice message, to the one playback of
 * the page: starting it pauses every other medium, and starting
 * another one pauses it.
 * @param media - The element of the player.
 * @param key - Stable per file, such as its address.
 * @returns The handlers to spread onto the element next to its own.
 */
export function useExclusivePlayback(
  media: React.RefObject<HTMLMediaElement | null>,
  key: string,
): { readonly claim: () => void; readonly release: () => void } {
  const handle = useRef<MediaHandle | null>(null);
  useEffect(() => {
    const registered = registerMedia(key, () => media.current);
    handle.current = registered;
    return () => {
      handle.current = null;
      unregisterMedia(registered);
    };
  }, [key, media]);
  return {
    claim: () => {
      if (handle.current) claimPlayback(handle.current);
    },
    release: () => {
      if (handle.current) releasePlayback(handle.current);
    },
  };
}

/**
 * The position and the length of a player as text.
 * @param positionSeconds - The played seconds.
 * @param durationSeconds - The length in seconds; `null` while unknown.
 * @returns For example `0:42 / 2:05`, or `0:42` while the length is unknown.
 */
export function formatMediaTime(
  positionSeconds: number,
  durationSeconds: number | null,
): string {
  const position = formatSeconds(positionSeconds);
  return durationSeconds === null
    ? position
    : `${position} / ${formatSeconds(durationSeconds)}`;
}

/**
 * The position and the length of a sound in the one fixed form of the sound
 * rows: always `0:41 / 1:52`, with `–:––` for a length not known yet.
 *
 * @param positionSeconds - The played seconds.
 * @param durationSeconds - The length in seconds; `null` while unknown.
 */
export function formatFixedMediaTime(
  positionSeconds: number,
  durationSeconds: number | null,
): string {
  const length =
    durationSeconds === null ? "–:––" : formatSeconds(durationSeconds);
  return `${formatSeconds(positionSeconds)} / ${length}`;
}

/**
 * Seconds as minutes and seconds, with hours for a long file.
 *
 * @param value - The seconds.
 * @returns For example `0:07`, `2:05` or `1:02:05`.
 */
export function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0
    ? `${String(hours)}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${String(minutes)}:${rest}`;
}
