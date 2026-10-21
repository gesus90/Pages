import { useState } from "react";

import { parseServerAddress } from "@/api/server-address";
import { SERVER_ADDRESS_OPTIONS } from "@/connection/address-policy";
import { useSettings } from "@/settings/settings-provider";

import type { ServerAddressProblem } from "@/api/server-address";

/** State and actions of the server address field. */
export interface ServerAddressForm {
  readonly draft: string;
  /** Why the draft cannot be saved; set by the last save attempt. */
  readonly problem: ServerAddressProblem | null;
  /** Whether the draft differs from the saved address. */
  readonly isChanged: boolean;
  /** Whether an address is saved, so that there is something to remove. */
  readonly hasSavedAddress: boolean;
  readonly setDraft: (text: string) => void;
  readonly save: () => void;
  readonly remove: () => void;
}

/**
 * Drives the server address field of the settings.
 *
 * @returns The draft the person types and the actions that keep or remove the
 * address. A draft is checked and normalized before it is saved.
 */
export function useServerAddressForm(): ServerAddressForm {
  const { settings, updateSettings } = useSettings();
  const savedAddress = settings.serverUrl ?? "";
  const [draft, setDraftText] = useState(savedAddress);
  const [problem, setProblem] = useState<ServerAddressProblem | null>(null);

  function setDraft(text: string): void {
    setDraftText(text);
    setProblem(null);
  }

  function save(): void {
    const result = parseServerAddress(draft, SERVER_ADDRESS_OPTIONS);

    if (!result.ok) {
      setProblem(result.problem);

      return;
    }

    updateSettings({ serverUrl: result.url });
    setDraftText(result.url);
    setProblem(null);
  }

  function remove(): void {
    updateSettings({ serverUrl: null });
    setDraftText("");
    setProblem(null);
  }

  return {
    draft,
    problem,
    isChanged: draft.trim() !== savedAddress,
    hasSavedAddress: savedAddress !== "",
    setDraft,
    save,
    remove,
  };
}
