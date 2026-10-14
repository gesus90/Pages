import { useCallback, useEffect, useState } from "react";

import { requestDiscord } from "@/app/lib/discord-client";

import type { DiscordIntent } from "@/app/lib/discord-client";
import type {
  DiscordActionErrorCode,
  DiscordInterfaceState,
  DiscordTestResult,
} from "@/definition/Discord";

/** How often a waiting connection attempt asks whether Discord answered. */
const POLL_INTERVAL_MS = 2_500;

/** The install link together with the attempt it belongs to. */
interface AttemptLink {
  readonly attemptId: string;
  readonly url: string;
}

/**
 * Keeps the channel list that is already shown when a state arrives without one.
 *
 * @remarks
 * Only the answers that list channels carry them. The list of the same server
 * stays, so changing an event or sending a test message does not close the
 * channel picker.
 */
function keepChannels(
  current: DiscordInterfaceState | null,
  next: DiscordInterfaceState,
): DiscordInterfaceState {
  if (
    current === null ||
    current.connection === null ||
    next.channels !== null ||
    next.attempt !== null ||
    next.connection?.guildId !== current.connection.guildId
  ) {
    return next;
  }

  return { ...next, channels: current.channels };
}

/** Remembers the link of the attempt the state shows; a link never outlives its attempt. */
function nextLink(
  current: AttemptLink | null,
  next: DiscordInterfaceState,
): AttemptLink | null {
  const attempt = next.attempt;

  if (attempt?.status !== "pending") {
    return null;
  }

  if (attempt.authorizeUrl !== null) {
    return { attemptId: attempt.id, url: attempt.authorizeUrl };
  }

  return current?.attemptId === attempt.id ? current : null;
}

/** Everything the Discord panel shows and the actions it can take. */
export interface DiscordPanelModel {
  readonly state: DiscordInterfaceState | null;
  readonly isLoading: boolean;
  readonly isBusy: boolean;
  /** The code of the last refused request, or `null`. */
  readonly failure: DiscordActionErrorCode | null;
  /** Result of the last test message, or `null` while there is none to show. */
  readonly testResult: DiscordTestResult | null;
  /** The official link of the running attempt; only this view ever receives it. */
  readonly authorizeUrl: string | null;
  readonly run: (
    intent: DiscordIntent,
    fields?: Readonly<Record<string, string>>,
  ) => Promise<void>;
  /** Reads the state again; with `true` it lists the channels of the connected server. */
  readonly reload: (includeChannels?: boolean) => Promise<void>;
}

/**
 * Loads the Discord state of a project and carries out the panel's actions.
 *
 * @param projectId - The project of the panel.
 * @param onConnectionChange - Told whenever the state shows whether the project is connected.
 * @returns The state, the busy and failure flags and the actions.
 *
 * @remarks
 * While a connection attempt waits for Discord, the state is read again every
 * few seconds, so the computer notices the authorization that happened on the
 * phone. The link of the attempt is kept here only; the server cannot show it
 * again after a reload and offers a new attempt instead.
 */
export function useDiscordPanel(
  projectId: string,
  onConnectionChange: (isConnected: boolean) => void,
): DiscordPanelModel {
  const [state, setState] = useState<DiscordInterfaceState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [failure, setFailure] = useState<DiscordActionErrorCode | null>(null);
  const [testResult, setTestResult] = useState<DiscordTestResult | null>(null);
  const [link, setLink] = useState<AttemptLink | null>(null);

  const apply = useCallback(
    (next: DiscordInterfaceState): void => {
      setState((current) => keepChannels(current, next));
      setLink((current) => nextLink(current, next));
      onConnectionChange(next.connection !== null);
    },
    [onConnectionChange],
  );

  const reload = useCallback(
    async (includeChannels = false): Promise<void> => {
      const result = await requestDiscord({ includeChannels, projectId });

      if (result.ok) {
        apply(result.state);
        setFailure(null);
      } else {
        setFailure(result.error);
      }

      setIsLoading(false);
    },
    [apply, projectId],
  );

  const run = useCallback(
    async (
      intent: DiscordIntent,
      fields: Readonly<Record<string, string>> = {},
    ): Promise<void> => {
      setIsBusy(true);
      setTestResult(null);

      const result = await requestDiscord({ fields, intent, projectId });

      if (result.ok) {
        apply(result.state);
        setFailure(null);
        setTestResult(result.test);
      } else {
        setFailure(result.error);
      }

      setIsBusy(false);
    },
    [apply, projectId],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  const isWaiting = state?.attempt?.status === "pending";

  useEffect(() => {
    if (!isWaiting) {
      return;
    }

    const timer = window.setInterval(() => {
      void reload();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [isWaiting, reload]);

  return {
    authorizeUrl: link?.url ?? null,
    failure,
    isBusy,
    isLoading,
    reload,
    run,
    state,
    testResult,
  };
}
