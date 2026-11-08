import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";

import { GOOGLE_DRIVE_CALLBACK_OUTCOMES } from "@/definition/GoogleDrive";

import {
  requestGoogleDriveSignIn,
  requestGoogleDriveStatus,
} from "./google-drive-requests";

import type {
  GoogleDriveActionResult,
  GoogleDriveCallbackOutcome,
  GoogleDriveStatus,
} from "@/definition/GoogleDrive";

/** What the card knows about the connection. */
export type GoogleDriveReading =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "loaded"; readonly status: GoogleDriveStatus };

/** The state and the one action of the Google Drive card. */
export interface GoogleDriveCardModel {
  readonly reading: GoogleDriveReading;
  /** The result of the last sign-in, as Google's callback reported it. */
  readonly outcome: GoogleDriveCallbackOutcome | null;
  readonly startError:
    Exclude<GoogleDriveActionResult, { ok: true }>["error"] | null;
  readonly isStarting: boolean;
  readonly signIn: () => void;
}

function readOutcome(value: string | null): GoogleDriveCallbackOutcome | null {
  return (
    GOOGLE_DRIVE_CALLBACK_OUTCOMES.find((outcome) => outcome === value) ?? null
  );
}

/** Reads the status once per visit; the server confirms it with a real Drive request. */
function useGoogleDriveReading(): GoogleDriveReading {
  const [reading, setReading] = useState<GoogleDriveReading>({
    kind: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();

    async function load(): Promise<void> {
      const status = await requestGoogleDriveStatus(controller.signal);

      if (!controller.signal.aborted) {
        setReading(status ? { kind: "loaded", status } : { kind: "failed" });
      }
    }

    void load();

    return () => controller.abort();
  }, []);

  return reading;
}

/**
 * Provides the status of the Google Drive connection and starts the sign-in.
 *
 * @returns The model of the card.
 *
 * @remarks
 * The sign-in leaves Pages for Google's own page; Google sends the browser
 * back to the callback, which returns to the system settings with the outcome.
 */
export function useGoogleDrive(): GoogleDriveCardModel {
  const reading = useGoogleDriveReading();
  const [searchParams] = useSearchParams();
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] =
    useState<GoogleDriveCardModel["startError"]>(null);

  async function start(): Promise<void> {
    setIsStarting(true);
    setStartError(null);
    const result = await requestGoogleDriveSignIn();

    if (result.ok) {
      window.location.assign(result.authorizeUrl);

      return;
    }

    setStartError(result.error);
    setIsStarting(false);
  }

  return {
    isStarting,
    outcome: readOutcome(searchParams.get("googleDrive")),
    reading,
    signIn: () => void start(),
    startError,
  };
}
