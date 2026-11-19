import { useEffect, useState } from "react";

import { listAudioDevices, NO_AUDIO_DEVICES } from "./audio-devices";

import type { AudioDeviceList } from "./audio-devices";

/** The devices the browser lists and how to read them again, such as after a permission. */
export interface AudioDevices {
  readonly list: AudioDeviceList;
  /** Whether the list was read at least once; before, nothing is known. */
  readonly isLoaded: boolean;
  readonly refresh: () => void;
}

/**
 * Lists the microphones and loudspeakers while the component shows, and again
 * whenever one is plugged in or removed.
 * @remarks
 * Listing opens no device and asks for no permission.
 */
export function useAudioDevices(): AudioDevices {
  const [list, setList] = useState<AudioDeviceList>(NO_AUDIO_DEVICES);
  const [isLoaded, setIsLoaded] = useState(false);
  const [readCount, setReadCount] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    function read(): void {
      listAudioDevices()
        .then((next) => {
          if (!isCurrent) return;
          setList(next);
          setIsLoaded(true);
        })
        .catch((error: unknown) => {
          console.warn("Pages could not list the audio devices.", error);
        });
    }
    read();
    const devices =
      typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    devices?.addEventListener("devicechange", read);
    return () => {
      isCurrent = false;
      devices?.removeEventListener("devicechange", read);
    };
  }, [readCount]);

  return { list, isLoaded, refresh: () => setReadCount((count) => count + 1) };
}
