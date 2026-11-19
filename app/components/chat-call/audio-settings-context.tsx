import { createContext, useContext, useState } from "react";

import { AudioSettingsDialog } from "./audio-settings-dialog";

/** What opens the dialog "Audio-Einstellungen" from the menu of a chat or the bar of a call. */
export interface AudioSettingsControl {
  readonly open: () => void;
}

const NO_SETTINGS: AudioSettingsControl = { open: () => undefined };

const AudioSettingsContext = createContext<AudioSettingsControl>(NO_SETTINGS);

/** Reads how to open the audio settings; outside the provider it opens nothing. */
export function useAudioSettings(): AudioSettingsControl {
  return useContext(AudioSettingsContext);
}

/**
 * Owns the one dialog "Audio-Einstellungen" of the signed-in page.
 * @remarks
 * The dialog sits above the chats, so the menu of any chat and the bar of a
 * running call open the same one, and a running call goes on while it is open.
 */
export function AudioSettingsProvider({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <AudioSettingsContext value={{ open: () => setIsOpen(true) }}>
      {children}
      <AudioSettingsDialog isOpen={isOpen} onOpenChange={setIsOpen} />
    </AudioSettingsContext>
  );
}
