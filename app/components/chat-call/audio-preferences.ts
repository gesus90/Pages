import { useSyncExternalStore } from "react";

/** A device the person chose: its ID in this browser and its name for the menu. */
export interface ChosenAudioDevice {
  readonly id: string;
  readonly label: string;
}

/**
 * The audio devices of this browser for calls in every chat.
 * @remarks
 * `null` is the system default. The choice belongs to the browser, not to
 * the account.
 */
export interface AudioPreferences {
  readonly microphone: ChosenAudioDevice | null;
  readonly speaker: ChosenAudioDevice | null;
}

const STORAGE_KEY = "pages.audio.devices";

const NO_PREFERENCES: AudioPreferences = { microphone: null, speaker: null };

const listeners = new Set<() => void>();

let cachedText: string | null = null;
let cachedPreferences: AudioPreferences = NO_PREFERENCES;

function readDevice(input: unknown): ChosenAudioDevice | null {
  if (typeof input !== "object" || input === null) return null;
  if (!("id" in input) || typeof input.id !== "string" || input.id === "")
    return null;
  const label =
    "label" in input && typeof input.label === "string" ? input.label : "";
  return { id: input.id, label };
}

function parsePreferences(text: string): AudioPreferences {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return NO_PREFERENCES;
    return {
      microphone: "microphone" in parsed ? readDevice(parsed.microphone) : null,
      speaker: "speaker" in parsed ? readDevice(parsed.speaker) : null,
    };
  } catch (error: unknown) {
    console.warn("Pages could not read the audio device choice.", error);
    return NO_PREFERENCES;
  }
}

function readStoredText(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (error: unknown) {
    console.warn("Pages could not read the audio device choice.", error);
    return null;
  }
}

/**
 * Reads the audio devices chosen in this browser.
 * @remarks
 * Only in the browser; storage that is blocked or holds something else reads
 * as the system default. The same object returns while the stored text stays
 * the same.
 */
export function readAudioPreferences(): AudioPreferences {
  const text = readStoredText();
  if (text === cachedText) return cachedPreferences;
  cachedText = text;
  cachedPreferences = text === null ? NO_PREFERENCES : parsePreferences(text);
  return cachedPreferences;
}

/**
 * Keeps a new choice of microphone or speaker for the next call.
 * @param change - The device that changes; `null` returns to the system default.
 */
export function writeAudioPreferences(change: Partial<AudioPreferences>): void {
  const next = { ...readAudioPreferences(), ...change };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (error: unknown) {
    console.warn("Pages could not keep the audio device choice.", error);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readServerPreferences(): AudioPreferences {
  return NO_PREFERENCES;
}

/** The audio devices chosen in this browser; the system default while rendering on the server. */
export function useAudioPreferences(): AudioPreferences {
  return useSyncExternalStore(
    subscribe,
    readAudioPreferences,
    readServerPreferences,
  );
}
