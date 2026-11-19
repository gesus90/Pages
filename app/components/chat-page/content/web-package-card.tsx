import { Gamepad2, Play, ShieldCheck, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  CONVERSATION_WEB_PACKAGE_MANIFEST_NAME,
  conversationWebPackageSessionSchema,
} from "@/definition/ConversationInteractiveContent";

import { CardAction, ContentCard } from "./content-card";
import { useFullscreenElement } from "./use-fullscreen-element";
import { useRetention } from "./use-retention";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { ConversationWebPackageSession } from "@/definition/ConversationInteractiveContent";

const SESSIONS_ADDRESS = "/chat-page-api/web-packages";

/**
 * The sandbox of a player on the origin of Pages: scripts and the pointer
 * lock of a game, without the own origin, so the browser gives it an opaque
 * one that reaches neither cookies, storage nor windows of Pages.
 */
const OPAQUE_SANDBOX = "allow-scripts allow-pointer-lock";

/** The secret of a start as it appears in the address of its player. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/u;

/** Why a player does not run. */
type PlayerFailure = "webgl" | "denied" | "start";

/** The states of the card: start image, loading, the running scene, a failure. */
type PlayerState =
  | { readonly status: "poster"; readonly failure: PlayerFailure | null }
  | { readonly status: "starting" }
  | {
      readonly status: "loading" | "running";
      readonly session: ConversationWebPackageSession;
    };

interface WebPackageCardProps {
  readonly attachment: ConversationAttachment;
}

/** Whether the browser offers WebGL 2, which the Compatibility renderer needs. */
function hasWebGl2(): boolean {
  try {
    return document.createElement("canvas").getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

/** The name of the scene: the attachment name without the manifest ending. */
function sceneName(attachment: ConversationAttachment): string {
  const suffix = `.${CONVERSATION_WEB_PACKAGE_MANIFEST_NAME}`;
  return attachment.name.endsWith(suffix)
    ? attachment.name.slice(0, -suffix.length)
    : attachment.name;
}

/** The secret of a start, from the address of its entry page or its frame document. */
function tokenOf(session: ConversationWebPackageSession): string {
  const parts = new URL(session.url, window.location.href).pathname.split("/");
  return parts.find((part) => TOKEN.test(part)) ?? "";
}

/** Ends a start on the server; the player loads nothing more with it. */
function revokeSession(session: ConversationWebPackageSession): void {
  void fetch(
    `${SESSIONS_ADDRESS}?token=${encodeURIComponent(tokenOf(session))}`,
    { method: "DELETE", keepalive: true },
  ).catch(() => undefined);
}

async function requestSession(
  attachmentId: string,
): Promise<ConversationWebPackageSession | PlayerFailure> {
  try {
    const response = await fetch(SESSIONS_ADDRESS, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attachmentId }),
    });
    if (response.status === 403 || response.status === 404) return "denied";
    if (!response.ok) return "start";
    const body: unknown = await response.json();
    const session = conversationWebPackageSessionSchema.safeParse(
      typeof body === "object" && body !== null && "session" in body
        ? body.session
        : null,
    );
    return session.success ? session.data : "start";
  } catch {
    return "start";
  }
}

/**
 * The sandbox of a frame. A player on the origin of Pages gets an opaque
 * origin. A player on an origin of its own comes inside the frame document
 * of Pages, which runs no script and frames only that origin; a sandbox
 * there would take the own origin from the player, so it has none.
 */
function sandboxOf(session: ConversationWebPackageSession): string | undefined {
  return session.isOwnOrigin ? undefined : OPAQUE_SANDBOX;
}

/** Starts and stops the player; a start ends with the card. */
function usePlayer(attachmentId: string): {
  readonly state: PlayerState;
  readonly start: () => void;
  readonly stop: () => void;
  readonly markRunning: () => void;
} {
  const [state, setState] = useState<PlayerState>({
    status: "poster",
    failure: null,
  });
  const session = "session" in state ? state.session : null;
  useEffect(() => {
    if (session === null) return;
    return () => revokeSession(session);
  }, [session]);

  function start(): void {
    if (!hasWebGl2()) {
      setState({ status: "poster", failure: "webgl" });
      return;
    }
    setState({ status: "starting" });
    void requestSession(attachmentId).then((result) => {
      setState(
        typeof result === "string"
          ? { status: "poster", failure: result }
          : { status: "loading", session: result },
      );
    });
  }

  function stop(): void {
    setState({ status: "poster", failure: null });
  }

  function markRunning(): void {
    setState((current) =>
      current.status === "loading"
        ? { status: "running", session: current.session }
        : current,
    );
  }

  return { state, start, stop, markRunning };
}

interface PosterProps {
  readonly attachment: ConversationAttachment;
  readonly failure: PlayerFailure | null;
  readonly isStarting: boolean;
  readonly onStart: () => void;
}

/** The start image with "Starten" and the note on the isolation, or the reason of a failure. */
function PlayerPoster({
  attachment,
  failure,
  isStarting,
  onStart,
}: PosterProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 p-3" data-player-poster="">
      {attachment.thumbnailUrl ? (
        <img
          alt={t("chatPage.cards.webPackage.poster", {
            name: sceneName(attachment),
          })}
          className="max-h-72 w-full rounded-md object-contain"
          src={attachment.thumbnailUrl}
        />
      ) : (
        <span className="flex h-40 w-full items-center justify-center rounded-md bg-panel-body">
          <Gamepad2
            aria-hidden="true"
            className="size-8 text-muted-foreground"
          />
        </span>
      )}
      {failure ? (
        <p
          className="text-center text-xs text-destructive"
          data-player-failure={failure}
          role="alert"
        >
          {t(`chatPage.cards.webPackage.failed.${failure}`)}
        </p>
      ) : null}
      {failure === "webgl" ? null : (
        <button
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
          disabled={isStarting}
          onClick={onStart}
          type="button"
        >
          <Play aria-hidden="true" className="size-3.5" />
          {isStarting
            ? t("chatPage.cards.webPackage.starting")
            : t("chatPage.cards.webPackage.start")}
        </button>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <ShieldCheck
          aria-hidden="true"
          className="size-3.5 shrink-0 text-primary"
        />
        {t("chatPage.cards.webPackage.isolation")}
      </p>
    </div>
  );
}

interface FrameProps {
  readonly attachment: ConversationAttachment;
  readonly session: ConversationWebPackageSession;
  readonly isLoading: boolean;
  readonly isFullscreen: boolean;
  readonly onLoad: () => void;
}

/** The isolated frame of the player; it has no bridge to the chat. */
function PlayerFrame({
  attachment,
  session,
  isLoading,
  isFullscreen,
  onLoad,
}: FrameProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "relative w-full bg-panel-body",
        isFullscreen ? "h-full" : "aspect-video",
      )}
      data-player-stage={isLoading ? "loading" : "running"}
    >
      <iframe
        allow="fullscreen; gamepad; autoplay"
        className="block size-full border-0"
        onLoad={onLoad}
        referrerPolicy="no-referrer"
        sandbox={sandboxOf(session)}
        src={session.url}
        title={t("chatPage.cards.webPackage.frame", {
          name: sceneName(attachment),
        })}
      />
      {isLoading ? (
        <p
          className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground"
          role="status"
        >
          {t("chatPage.cards.webPackage.loading")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The card of a Godot web export of a message: its start image with
 * "Starten", then the scene in an isolated frame of its own, with "Stoppen"
 * and "Vollbild".
 * @remarks
 * Nothing loads before "Starten". The start asks Pages for an address of
 * 30 minutes for this member and package; the frame runs on the player
 * origin of Pages, or, without one, sandboxed with an opaque origin, never
 * with the sign-in of Pages and without any message bridge to the chat. The
 * scene runs in this browser, wherever it was exported. "Stoppen", closing
 * the card or leaving the chat ends the address.
 */
export function WebPackageCard({
  attachment,
}: WebPackageCardProps): React.ReactElement {
  const { t } = useTranslation();
  const retention = useRetention(attachment.expiresAt);
  const stage = useRef<HTMLDivElement>(null);
  const isFullscreen = useFullscreenElement(stage);
  const player = usePlayer(attachment.id);
  const { state } = player;

  function handleFullscreen(): void {
    if (state.status === "poster") player.start();
    void stage.current?.requestFullscreen().catch(() => undefined);
  }

  const stopAction =
    state.status === "loading" || state.status === "running" ? (
      <CardAction
        icon={Square}
        label={t("chatPage.cards.webPackage.stop")}
        onClick={player.stop}
      />
    ) : null;

  return (
    <ContentCard
      actions={stopAction}
      cardKey={`att:${attachment.id}`}
      className="max-w-2xl"
      defaultState="expanded"
      icon={Gamepad2}
      kindLabel={t("chatPage.cards.kind.webPackage")}
      meta={t("chatPage.cards.webPackage.meta")}
      name={sceneName(attachment)}
      onFullscreen={handleFullscreen}
      retention={retention}
    >
      <div
        ref={stage}
        className={cn("bg-surface", isFullscreen && "h-full")}
        data-web-package-card=""
      >
        {state.status === "loading" || state.status === "running" ? (
          <PlayerFrame
            attachment={attachment}
            isFullscreen={isFullscreen}
            isLoading={state.status === "loading"}
            onLoad={player.markRunning}
            session={state.session}
          />
        ) : (
          <PlayerPoster
            attachment={attachment}
            failure={state.status === "poster" ? state.failure : null}
            isStarting={state.status === "starting"}
            onStart={player.start}
          />
        )}
      </div>
    </ContentCard>
  );
}
