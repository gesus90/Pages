import { useRef, useState } from "react";

/** The speeds a player steps through, in this order. */
const SPEEDS: readonly number[] = [1, 1.5, 2, 0.5];

/** Playing, the position, the length and the speed of one video or audio element. */
export interface MediaPlayer<TElement extends HTMLMediaElement> {
  readonly media: React.RefObject<TElement | null>;
  readonly isPlaying: boolean;
  readonly positionSeconds: number;
  /** The length; `null` until the element knows it. */
  readonly durationSeconds: number | null;
  /** The played part, from 0 to 1. */
  readonly share: number;
  readonly speed: number;
  toggle(): void;
  /** Jumps to a part of the length, from 0 to 1; nothing before the length is known. */
  seek(share: number): void;
  /** Steps to the next speed: 1× → 1,5× → 2× → 0,5×. */
  nextSpeed(): void;
  readonly events: Pick<
    React.MediaHTMLAttributes<TElement>,
    "onPlay" | "onPause" | "onEnded" | "onTimeUpdate" | "onDurationChange"
  >;
}

/**
 * The state of an own player around a `<video>` or `<audio>` element
 * (PAGE-298): give `media` as its ref and spread `events` onto it.
 *
 * @returns The state and the actions of the player.
 */
export function useMediaPlayer<
  TElement extends HTMLMediaElement,
>(): MediaPlayer<TElement> {
  const media = useRef<TElement | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const [positionSeconds, setPosition] = useState(0);
  const [durationSeconds, setDuration] = useState<number | null>(null);
  const [speed, setSpeed] = useState(1);

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

  function seek(share: number): void {
    const element = media.current;
    if (!element || durationSeconds === null) return;
    const target = Math.min(1, Math.max(0, share)) * durationSeconds;
    element.currentTime = target;
    setPosition(target);
  }

  function nextSpeed(): void {
    const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1;
    setSpeed(next);
    if (media.current) media.current.playbackRate = next;
  }

  const share =
    durationSeconds === null || durationSeconds <= 0
      ? 0
      : Math.min(1, positionSeconds / durationSeconds);

  return {
    media,
    isPlaying,
    positionSeconds,
    durationSeconds,
    share,
    speed,
    toggle,
    seek,
    nextSpeed,
    events: {
      onPlay: () => setPlaying(true),
      onPause: () => setPlaying(false),
      onEnded: () => setPlaying(false),
      onTimeUpdate: (event) => setPosition(event.currentTarget.currentTime),
      onDurationChange: (event) => {
        const { duration } = event.currentTarget;
        setDuration(Number.isFinite(duration) ? duration : null);
      },
    },
  };
}

/**
 * The position and the length of a player as text.
 *
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

function formatSeconds(value: number): string {
  const seconds = Math.max(0, Math.floor(value));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
