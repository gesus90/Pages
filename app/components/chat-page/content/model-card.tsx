import { Box, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { downloadUrl, formatFileSize } from "./card-types";
import { CardAction, ContentCard } from "./content-card";
import { GlbModelError, readGlbModel } from "./model-card/glb-model";
import {
  DEFAULT_ORBIT_VIEW,
  GlbRenderer,
  ORBIT_ZOOM_RANGE,
  WebGlUnavailableError,
} from "./model-card/glb-renderer";
import { useFullscreenElement } from "./use-fullscreen-element";
import { useRetention } from "./use-retention";

import type { ConversationAttachment } from "@/definition/ConversationContent";
import type { OrbitView } from "./model-card/glb-renderer";

/** Radians a drag of one CSS pixel turns the model. */
const TURN_PER_PIXEL = 0.01;
/** Radians one press of an arrow key turns the model. */
const TURN_PER_KEY = 0.15;
const PITCH_LIMIT = 1.45;

/** Why the viewer shows the start image instead of the model. */
type ViewerFailure = "webgl" | "load" | "format";

/** The states of the card: start image, loading, the interactive model, a failure. */
type ViewerStatus = "poster" | "loading" | "ready" | "failed";

interface ViewerState {
  readonly status: ViewerStatus;
  readonly failure: ViewerFailure | null;
}

interface ModelCardProps {
  readonly attachment: ConversationAttachment;
}

/** The parts of a running viewer the handlers of the canvas share. */
interface ViewerParts {
  readonly canvas: React.RefObject<HTMLCanvasElement | null>;
  readonly renderer: React.RefObject<GlbRenderer | null>;
  readonly view: React.RefObject<OrbitView>;
  readonly frame: React.RefObject<number>;
}

function failureOf(error: unknown): ViewerFailure {
  if (error instanceof WebGlUnavailableError) return "webgl";
  if (error instanceof GlbModelError) return "format";
  return "load";
}

function clampView(view: OrbitView): OrbitView {
  return {
    yaw: view.yaw,
    pitch: Math.min(Math.max(view.pitch, -PITCH_LIMIT), PITCH_LIMIT),
    zoom: Math.min(
      Math.max(view.zoom, ORBIT_ZOOM_RANGE.minimum),
      ORBIT_ZOOM_RANGE.maximum,
    ),
  };
}

/** Draws the model once in the next frame, however often it is asked. */
function scheduleDraw(parts: ViewerParts): void {
  if (parts.frame.current !== 0) return;
  parts.frame.current = requestAnimationFrame(() => {
    parts.frame.current = 0;
    parts.renderer.current?.render(parts.view.current);
  });
}

function changeView(
  parts: ViewerParts,
  change: (view: OrbitView) => OrbitView,
): void {
  parts.view.current = clampView(change(parts.view.current));
  scheduleDraw(parts);
}

/** Loads, reads and draws the model once the viewer is started. */
function useModelLoading(
  parts: ViewerParts,
  url: string,
  isStarted: boolean,
  setState: (state: ViewerState) => void,
): void {
  useEffect(() => {
    const canvas = parts.canvas.current;
    if (!isStarted || !canvas) return;
    let isCancelled = false;
    let renderer: GlbRenderer | null = null;
    void (async () => {
      try {
        const response = await fetch(url, { credentials: "same-origin" });
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const model = readGlbModel(await response.arrayBuffer());
        if (isCancelled) return;
        renderer = await GlbRenderer.create(canvas, model);
        if (isCancelled) return;
        renderer.resize(
          canvas.clientWidth,
          canvas.clientHeight,
          devicePixelRatio,
        );
        parts.renderer.current = renderer;
        parts.view.current = DEFAULT_ORBIT_VIEW;
        scheduleDraw(parts);
        setState({ status: "ready", failure: null });
      } catch (error: unknown) {
        if (!isCancelled)
          setState({ status: "failed", failure: failureOf(error) });
      }
    })();
    return () => {
      isCancelled = true;
      cancelAnimationFrame(parts.frame.current);
      parts.frame.current = 0;
      parts.renderer.current = null;
      renderer?.dispose();
    };
  }, [parts, url, isStarted, setState]);
}

/** Turns with a drag, zooms with the wheel or two fingers, and follows the size of the canvas. */
function useOrbitControls(parts: ViewerParts, isReady: boolean): void {
  useEffect(() => {
    const canvas = parts.canvas.current;
    if (!isReady || !canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    function spread(): number {
      const [first, second] = [...pointers.values()];
      return first && second
        ? Math.hypot(first.x - second.x, first.y - second.y)
        : 0;
    }
    function handleDown(event: PointerEvent): void {
      canvas?.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      pinch = spread();
    }
    function handleMove(event: PointerEvent): void {
      const last = pointers.get(event.pointerId);
      if (!last) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2) {
        const current = spread();
        if (pinch > 0 && current > 0)
          changeView(parts, (view) => ({
            ...view,
            zoom: view.zoom * (current / pinch),
          }));
        pinch = current;
        return;
      }
      changeView(parts, (view) => ({
        ...view,
        yaw: view.yaw - (event.clientX - last.x) * TURN_PER_PIXEL,
        pitch: view.pitch + (event.clientY - last.y) * TURN_PER_PIXEL,
      }));
    }
    function handleUp(event: PointerEvent): void {
      pointers.delete(event.pointerId);
      pinch = spread();
    }
    function handleWheel(event: WheelEvent): void {
      event.preventDefault();
      changeView(parts, (view) => ({
        ...view,
        zoom: view.zoom * Math.exp(-event.deltaY * 0.0015),
      }));
    }
    const observer = new ResizeObserver(() => {
      parts.renderer.current?.resize(
        canvas.clientWidth,
        canvas.clientHeight,
        devicePixelRatio,
      );
      scheduleDraw(parts);
    });
    observer.observe(canvas);
    canvas.addEventListener("pointerdown", handleDown);
    canvas.addEventListener("pointermove", handleMove);
    canvas.addEventListener("pointerup", handleUp);
    canvas.addEventListener("pointercancel", handleUp);
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      observer.disconnect();
      canvas.removeEventListener("pointerdown", handleDown);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerup", handleUp);
      canvas.removeEventListener("pointercancel", handleUp);
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [parts, isReady]);
}

function zoomIn(view: OrbitView): OrbitView {
  return { ...view, zoom: view.zoom * 1.2 };
}

function zoomOut(view: OrbitView): OrbitView {
  return { ...view, zoom: view.zoom / 1.2 };
}

function resetView(): OrbitView {
  return DEFAULT_ORBIT_VIEW;
}

/** The changes of the view the keys of the canvas make. */
const KEY_CHANGES: Readonly<Record<string, (view: OrbitView) => OrbitView>> = {
  ArrowLeft: (view) => ({ ...view, yaw: view.yaw + TURN_PER_KEY }),
  ArrowRight: (view) => ({ ...view, yaw: view.yaw - TURN_PER_KEY }),
  ArrowUp: (view) => ({ ...view, pitch: view.pitch + TURN_PER_KEY }),
  ArrowDown: (view) => ({ ...view, pitch: view.pitch - TURN_PER_KEY }),
  "+": zoomIn,
  "-": zoomOut,
  "0": resetView,
};

interface PosterProps {
  readonly attachment: ConversationAttachment;
  readonly state: ViewerState;
  readonly onStart: () => void;
}

/** The start image with "3D-Ansicht starten", or after a failure with its reason. */
function ModelPoster({
  attachment,
  state,
  onStart,
}: PosterProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 p-3" data-model-poster="">
      {attachment.thumbnailUrl ? (
        <img
          alt={t("chatPage.cards.model.poster", { name: attachment.name })}
          className="max-h-72 w-full rounded-md object-contain"
          src={attachment.thumbnailUrl}
        />
      ) : (
        <span className="flex h-40 w-full items-center justify-center rounded-md bg-panel-body">
          <Box aria-hidden="true" className="size-8 text-muted-foreground" />
        </span>
      )}
      {state.failure ? (
        <p
          className="text-center text-xs text-destructive"
          data-model-failure={state.failure}
          role="alert"
        >
          {t(`chatPage.cards.model.failed.${state.failure}`)}
        </p>
      ) : null}
      {state.failure === "webgl" ? null : (
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          onClick={onStart}
          type="button"
        >
          {state.failure
            ? t("chatPage.cards.model.retry")
            : t("chatPage.cards.model.start")}
        </button>
      )}
    </div>
  );
}

interface StageProps {
  readonly attachment: ConversationAttachment;
  readonly parts: ViewerParts;
  readonly state: ViewerState;
  readonly isFullscreen: boolean;
}

/** "Vergrößern", "Verkleinern" and "Ansicht zurücksetzen" over the model. */
function ModelControls({
  parts,
}: {
  readonly parts: ViewerParts;
}): React.ReactElement {
  const { t } = useTranslation();
  function handleZoomIn(): void {
    changeView(parts, zoomIn);
  }
  function handleZoomOut(): void {
    changeView(parts, zoomOut);
  }
  function handleReset(): void {
    changeView(parts, resetView);
  }
  return (
    <div className="absolute inset-x-2 bottom-2 flex flex-wrap items-center justify-between gap-2">
      <span className="rounded bg-surface px-2 py-1 text-[11px] text-muted-foreground">
        {t("chatPage.cards.model.hint")}
      </span>
      <span className="flex gap-1 rounded bg-surface p-0.5">
        <CardAction
          icon={Plus}
          isIconOnly
          label={t("chatPage.cards.model.zoomIn")}
          onClick={handleZoomIn}
        />
        <CardAction
          icon={Minus}
          isIconOnly
          label={t("chatPage.cards.model.zoomOut")}
          onClick={handleZoomOut}
        />
        <CardAction
          icon={RotateCcw}
          label={t("chatPage.cards.model.reset")}
          onClick={handleReset}
        />
      </span>
    </div>
  );
}

/** The canvas of the model with its controls; while it loads, a status over it. */
function ModelStage({
  attachment,
  parts,
  state,
  isFullscreen,
}: StageProps): React.ReactElement {
  const { t } = useTranslation();
  function handleKey(event: React.KeyboardEvent<HTMLCanvasElement>): void {
    const change = KEY_CHANGES[event.key];
    if (!change) return;
    event.preventDefault();
    changeView(parts, change);
  }
  return (
    <div
      className={cn(
        "relative w-full bg-panel-body",
        isFullscreen ? "h-full" : "h-80 sm:h-96",
      )}
      data-model-stage={state.status}
    >
      <canvas
        ref={parts.canvas}
        aria-label={t("chatPage.cards.model.viewer", { name: attachment.name })}
        className="block size-full cursor-grab touch-none outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary active:cursor-grabbing"
        onKeyDown={handleKey}
        role="img"
        tabIndex={0}
      />
      {state.status === "loading" ? (
        <p
          className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground"
          role="status"
        >
          {t("chatPage.cards.model.loading")}
        </p>
      ) : null}
      {state.status === "ready" ? <ModelControls parts={parts} /> : null}
    </div>
  );
}

/**
 * The card of a glTF 2.0 model of a message, as Blender exports it: its PNG
 * start image with "3D-Ansicht starten", then the model in the viewer of
 * Pages, turned with a drag or the arrow keys, zoomed with the wheel, two
 * fingers or `+` and `-`, and reset with "Ansicht zurücksetzen".
 * @remarks
 * The model loads from the protected address of the attachment only once
 * the viewer is started, and nothing it names is loaded besides. Without
 * WebGL 2, or when the file cannot be read, the start image stays with the
 * reason. "Vollbild" shows the viewer on the whole screen.
 */
export function ModelCard({ attachment }: ModelCardProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const retention = useRetention(attachment.expiresAt);
  const stage = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ViewerState>({
    status: "poster",
    failure: null,
  });
  const [parts] = useState<ViewerParts>(() => ({
    canvas: { current: null },
    renderer: { current: null },
    view: { current: DEFAULT_ORBIT_VIEW },
    frame: { current: 0 },
  }));
  const isStarted = state.status === "loading" || state.status === "ready";
  const isFullscreen = useFullscreenElement(stage);
  useModelLoading(parts, attachment.url, isStarted, setState);
  useOrbitControls(parts, state.status === "ready");

  function handleStart(): void {
    setState({ status: "loading", failure: null });
  }

  function handleFullscreen(): void {
    if (!isStarted) handleStart();
    void stage.current?.requestFullscreen().catch(() => undefined);
  }

  return (
    <ContentCard
      cardKey={`att:${attachment.id}`}
      className="max-w-2xl"
      defaultState="expanded"
      download={{ href: downloadUrl(attachment) }}
      icon={Box}
      kindLabel={t("chatPage.cards.kind.model")}
      meta={formatFileSize(attachment.sizeBytes, i18n.language)}
      name={attachment.name}
      onFullscreen={handleFullscreen}
      retention={retention}
    >
      <div
        ref={stage}
        className={cn("bg-surface", isFullscreen && "h-full")}
        data-model-card=""
      >
        {isStarted ? (
          <ModelStage
            attachment={attachment}
            isFullscreen={isFullscreen}
            parts={parts}
            state={state}
          />
        ) : (
          <ModelPoster
            attachment={attachment}
            onStart={handleStart}
            state={state}
          />
        )}
      </div>
    </ContentCard>
  );
}
