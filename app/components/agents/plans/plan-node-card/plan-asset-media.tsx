import { FileText, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { planAssetUrl } from "@/app/lib/plan-asset-upload";

import { PLAN_NODE_TEXT } from "../plan-node-text";
import { formatPlanAssetDuration } from "./plan-asset-format";

import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";
import type { PlanAssetFacts } from "./plan-asset-format";

/** What every preview of a kind receives. */
export interface PlanAssetMediaProps {
  readonly file: AgentPlanAssetFile;
  readonly onFacts: (facts: PlanAssetFacts) => void;
  readonly onFailure: () => void;
}

/** Files up to this size are decoded for a real waveform or page image; larger ones show a still symbol. */
const DECODE_LIMIT = 25 * 1024 * 1024;
const WAVE_BARS = 36;

/** An image, drawn by an image element: an SVG inside it runs no script. */
export function PlanAssetImage(props: PlanAssetMediaProps): React.ReactElement {
  const { file } = props;
  return (
    <img
      src={planAssetUrl(file.assetId)}
      alt={file.fileName}
      loading="lazy"
      draggable={false}
      className="size-full object-contain"
      onLoad={(event) =>
        props.onFacts({
          dimensions: {
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          },
        })
      }
      onError={props.onFailure}
    />
  );
}

/** A small round play button over a still image or waveform. */
function PlayButton(props: {
  readonly label: string;
  readonly onPlay: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="nodrag nopan absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-surface text-foreground shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      aria-label={props.label}
      onClick={props.onPlay}
    >
      <Play aria-hidden="true" className="size-4 translate-x-px fill-current" />
    </button>
  );
}

function DurationBadge(props: {
  readonly duration: number | null;
}): React.ReactElement | null {
  if (props.duration === null) return null;
  return (
    <span
      className={cn(
        "absolute right-1.5 bottom-1.5 rounded bg-foreground/80 px-1.5 py-0.5 font-medium text-background",
        PLAN_NODE_TEXT.meta,
      )}
    >
      {formatPlanAssetDuration(props.duration)}
    </span>
  );
}

/**
 * A video: its first frame, a play symbol and its length.
 *
 * @remarks
 * Only the metadata loads at first; the video plays after a click and never
 * by itself.
 */
export function PlanAssetVideo(props: PlanAssetMediaProps): React.ReactElement {
  const { t } = useTranslation();
  const video = useRef<HTMLVideoElement | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  function play(): void {
    setPlaying(true);
    void video.current?.play().catch(() => setPlaying(false));
  }
  return (
    <div className="relative size-full bg-foreground">
      <video
        ref={video}
        src={`${planAssetUrl(props.file.assetId)}#t=0.1`}
        preload="metadata"
        muted
        playsInline
        controls={isPlaying}
        className="nodrag nopan size-full object-contain"
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          setDuration(
            Number.isFinite(element.duration) ? element.duration : null,
          );
          props.onFacts({
            duration: element.duration,
            dimensions: {
              width: element.videoWidth,
              height: element.videoHeight,
            },
          });
        }}
        onError={props.onFailure}
      />
      {isPlaying ? null : (
        <>
          <PlayButton label={t("plans.asset.play")} onPlay={play} />
          <DurationBadge duration={duration} />
        </>
      )}
    </div>
  );
}

/** Peaks of the decoded audio, or `null` when it is too large or cannot be decoded. */
function useWaveform(file: AgentPlanAssetFile): readonly number[] | null {
  const [peaks, setPeaks] = useState<readonly number[] | null>(null);
  useEffect(() => {
    if (file.size > DECODE_LIMIT) return undefined;
    const controller = new AbortController();
    async function decode(): Promise<void> {
      const response = await fetch(planAssetUrl(file.assetId), {
        signal: controller.signal,
      });
      const context = new AudioContext();
      try {
        const audio = await context.decodeAudioData(
          await response.arrayBuffer(),
        );
        const samples = audio.getChannelData(0);
        const step = Math.max(1, Math.floor(samples.length / WAVE_BARS));
        const values = Array.from({ length: WAVE_BARS }, (_, index) => {
          let peak = 0;
          for (
            let offset = index * step;
            offset < (index + 1) * step;
            offset += 64
          )
            peak = Math.max(peak, Math.abs(samples[offset] ?? 0));
          return peak;
        });
        const highest = Math.max(...values, 0.0001);
        if (!controller.signal.aborted)
          setPeaks(values.map((value) => value / highest));
      } finally {
        void context.close();
      }
    }
    void decode().catch(() => undefined);
    return () => controller.abort();
  }, [file.assetId, file.size]);
  return peaks;
}

/** An audio file: its waveform and length; it plays after a click and never by itself. */
export function PlanAssetAudio(props: PlanAssetMediaProps): React.ReactElement {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement | null>(null);
  const peaks = useWaveform(props.file);
  const [duration, setDuration] = useState<number | null>(null);
  const [isPlaying, setPlaying] = useState(false);
  const bars = peaks ?? Array.from({ length: WAVE_BARS }, () => 0.35);
  function play(): void {
    setPlaying(true);
    void audio.current?.play().catch(() => setPlaying(false));
  }
  return (
    <div className="relative flex size-full flex-col justify-center bg-surface px-3">
      <div
        aria-hidden="true"
        data-plan-asset-wave={peaks ? "decoded" : "pending"}
        className="flex h-16 items-center gap-0.5"
      >
        {bars.map((value, index) => (
          <span
            key={index}
            className="w-1 flex-1 rounded-full bg-plan-asset"
            style={{ height: `${Math.max(8, value * 100)}%` }}
          />
        ))}
      </div>
      <audio
        ref={audio}
        src={planAssetUrl(props.file.assetId)}
        preload="metadata"
        controls={isPlaying}
        className={cn("nodrag nopan mt-1 h-7 w-full", !isPlaying && "hidden")}
        onLoadedMetadata={(event) => {
          const length = event.currentTarget.duration;
          setDuration(Number.isFinite(length) ? length : null);
          props.onFacts({ duration: length });
        }}
        onError={props.onFailure}
      />
      {isPlaying ? null : (
        <>
          <PlayButton label={t("plans.asset.play")} onPlay={play} />
          <DurationBadge duration={duration} />
        </>
      )}
    </div>
  );
}

/** A stylized page, for documents without a page image of their own. */
function PageSymbol(): React.ReactElement {
  return (
    <div className="flex size-full items-center justify-center bg-muted">
      <div className="flex h-[85%] w-[38%] flex-col gap-1 rounded-sm border border-border bg-surface p-2 shadow-xs">
        <span className="h-1 w-1/2 rounded bg-muted-foreground/50" />
        {Array.from({ length: 6 }, (_, index) => (
          <span
            key={index}
            className="h-0.5 w-full rounded bg-muted-foreground/30"
          />
        ))}
        <FileText
          aria-hidden="true"
          className="mt-auto size-3 self-end text-muted-foreground"
        />
      </div>
    </div>
  );
}

/**
 * A document: the first page of a PDF as an image, drawn by pdf.js without
 * running any script of it; other documents show a page symbol.
 */
export function PlanAssetDocument(
  props: PlanAssetMediaProps,
): React.ReactElement {
  const { file, onFacts } = props;
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [isDrawn, setDrawn] = useState(false);
  const isPdf =
    file.mediaType === "application/pdf" && file.size <= DECODE_LIMIT;
  useEffect(() => {
    if (!isPdf) return undefined;
    const controller = new AbortController();
    async function draw(): Promise<void> {
      const { openPdfPreview } = await import("@/app/lib/pdf-preview");
      const pdf = await openPdfPreview(
        planAssetUrl(file.assetId),
        controller.signal,
      );
      try {
        if (!canvas.current || controller.signal.aborted) return;
        onFacts({ pages: pdf.pageCount });
        await pdf.render(1, canvas.current, 120);
        setDrawn(true);
      } finally {
        pdf.close();
      }
    }
    void draw().catch(() => undefined);
    return () => controller.abort();
  }, [file.assetId, isPdf, onFacts]);
  if (!isPdf) return <PageSymbol />;
  return (
    <div className="relative flex size-full items-center justify-center bg-muted">
      {isDrawn ? null : <PageSymbol />}
      <canvas
        ref={canvas}
        className={cn("h-[90%] w-auto shadow-xs", !isDrawn && "hidden")}
      />
    </div>
  );
}
