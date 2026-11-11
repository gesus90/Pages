import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  PlanAssetAudio,
  PlanAssetDocument,
  PlanAssetImage,
  PlanAssetVideo,
} from "@/app/components/agents/plans/plan-node-card/plan-asset-media";

import { i18n, renderTranslated } from "../plan-flow-fixture";

import type { Mock } from "vitest";
import type { PlanAssetFacts } from "@/app/components/agents/plans/plan-node-card/plan-asset-format";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";

type FactsHandler = (facts: PlanAssetFacts) => void;

const pdfPreview = vi.hoisted(() => ({ openPdfPreview: vi.fn() }));

vi.mock("@/app/lib/pdf-preview", () => pdfPreview);

const MEBIBYTE = 1024 * 1024;

function assetFile(
  overrides: Partial<AgentPlanAssetFile> = {},
): AgentPlanAssetFile {
  return {
    assetId: "asset/1",
    fileName: "clip.mp4",
    mediaType: "video/mp4",
    kind: "video",
    size: 2048,
    digest: "a".repeat(64),
    ...overrides,
  };
}

function defineMediaProperty(
  element: HTMLElement,
  name: string,
  value: number,
): void {
  Object.defineProperty(element, name, { configurable: true, value });
}

/** Handlers every preview gets, as spies. */
function handlers(): {
  onFacts: Mock<FactsHandler>;
  onFailure: () => void;
} {
  return { onFacts: vi.fn<FactsHandler>(), onFailure: vi.fn() };
}

beforeEach(() => {
  pdfPreview.openPdfPreview.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("draws an image from the asset address and reports its natural size", () => {
  const { onFacts, onFailure } = handlers();
  renderTranslated(
    <PlanAssetImage
      file={assetFile({ kind: "image", fileName: "photo.png" })}
      onFacts={onFacts}
      onFailure={onFailure}
    />,
  );
  const image = screen.getByRole("img", { name: "photo.png" });
  expect(image.getAttribute("src")).toBe("/agent-plan-assets/asset%2F1");
  expect(image.getAttribute("draggable")).toBe("false");

  defineMediaProperty(image, "naturalWidth", 640);
  defineMediaProperty(image, "naturalHeight", 480);
  fireEvent.load(image);

  expect(onFacts).toHaveBeenCalledWith({
    dimensions: { width: 640, height: 480 },
  });
  expect(onFailure).not.toHaveBeenCalled();
});

it("reports a failure when the image cannot be loaded", () => {
  const { onFacts, onFailure } = handlers();
  renderTranslated(
    <PlanAssetImage
      file={assetFile({ kind: "image", fileName: "photo.png" })}
      onFacts={onFacts}
      onFailure={onFailure}
    />,
  );
  fireEvent.error(screen.getByRole("img", { name: "photo.png" }));
  expect(onFailure).toHaveBeenCalledTimes(1);
  expect(onFacts).not.toHaveBeenCalled();
});

function renderVideo(): {
  video: HTMLVideoElement;
  onFacts: Mock<FactsHandler>;
  onFailure: () => void;
} {
  const { onFacts, onFailure } = handlers();
  const { container } = renderTranslated(
    <PlanAssetVideo
      file={assetFile()}
      onFacts={onFacts}
      onFailure={onFailure}
    />,
  );
  const video = container.querySelector("video");
  if (!video) throw new Error("The video is missing.");
  return { video, onFacts, onFailure };
}

it("loads only the metadata of a video and shows its length and size facts", () => {
  const { video, onFacts } = renderVideo();
  expect(video.getAttribute("src")).toBe("/agent-plan-assets/asset%2F1#t=0.1");
  expect(video.getAttribute("preload")).toBe("metadata");
  expect(video.controls).toBe(false);
  expect(screen.queryByText("3:05")).toBeNull();

  defineMediaProperty(video, "duration", 185);
  defineMediaProperty(video, "videoWidth", 1920);
  defineMediaProperty(video, "videoHeight", 1080);
  fireEvent.loadedMetadata(video);

  expect(screen.getByText("3:05")).toBeDefined();
  expect(onFacts).toHaveBeenCalledWith({
    duration: 185,
    dimensions: { width: 1920, height: 1080 },
  });
});

it("shows no length for a video of unknown duration", () => {
  const { video, onFacts } = renderVideo();
  defineMediaProperty(video, "duration", Number.POSITIVE_INFINITY);
  defineMediaProperty(video, "videoWidth", 10);
  defineMediaProperty(video, "videoHeight", 20);
  fireEvent.loadedMetadata(video);

  expect(screen.queryByText(/^\d+:\d{2}$/u)).toBeNull();
  expect(onFacts).toHaveBeenCalledWith({
    duration: Number.POSITIVE_INFINITY,
    dimensions: { width: 10, height: 20 },
  });
});

it("plays a video only after a click and then shows its controls", () => {
  const play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  const { video } = renderVideo();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.asset.play") }),
  );

  expect(play).toHaveBeenCalledTimes(1);
  expect(video.controls).toBe(true);
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.asset.play") }),
  ).toBeNull();
});

it("offers the play button again when the browser refuses to play the video", async () => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
    new Error("not allowed"),
  );
  const { video } = renderVideo();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.asset.play") }),
  );

  await waitFor(() => expect(video.controls).toBe(false));
  expect(
    screen.getByRole("button", { name: i18n.t("plans.asset.play") }),
  ).toBeDefined();
});

it("reports a video that cannot be loaded", () => {
  const { video, onFailure } = renderVideo();
  fireEvent.error(video);
  expect(onFailure).toHaveBeenCalledTimes(1);
});

const WAVE_BARS = 36;

/** Samples that put the peak `peaks[index]` at the start of bar `index`. */
function wavefile(peaks: readonly number[]): Float32Array {
  const samples = new Float32Array(WAVE_BARS * 64);
  peaks.forEach((peak, index) => {
    samples[index * 64] = peak;
  });
  return samples;
}

interface AudioStubs {
  readonly close: ReturnType<typeof vi.fn>;
  readonly fetchSpy: ReturnType<typeof vi.fn>;
}

/** An `AudioContext` constructor whose contexts decode with `decode` and close with `close`. */
function audioContextOf(
  decode: () => Promise<{ getChannelData: () => Float32Array }>,
  close: () => Promise<void>,
): ReturnType<typeof vi.fn> {
  return vi.fn(function createContext() {
    return { decodeAudioData: decode, close };
  });
}

function stubDecoding(samples: Float32Array): AudioStubs {
  const close = vi.fn(() => Promise.resolve());
  const fetchSpy = vi.fn(() =>
    Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }),
  );
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal(
    "AudioContext",
    audioContextOf(
      () => Promise.resolve({ getChannelData: () => samples }),
      close,
    ),
  );
  return { close, fetchSpy };
}

function renderAudio(file: AgentPlanAssetFile = assetFile({ kind: "audio" })): {
  container: HTMLElement;
  unmount: () => void;
  onFacts: Mock<FactsHandler>;
  onFailure: () => void;
} {
  const { onFacts, onFailure } = handlers();
  const { container, unmount } = renderTranslated(
    <PlanAssetAudio file={file} onFacts={onFacts} onFailure={onFailure} />,
  );
  return { container, unmount, onFacts, onFailure };
}

function waveOf(container: HTMLElement): HTMLElement {
  const wave = container.querySelector<HTMLElement>("[data-plan-asset-wave]");
  if (!wave) throw new Error("The waveform is missing.");
  return wave;
}

it("replaces the placeholder bars of an audio file by the decoded waveform", async () => {
  const peaks = Array.from({ length: WAVE_BARS }, () => 0.05);
  peaks[0] = 0.5;
  peaks[1] = 0.25;
  const { close, fetchSpy } = stubDecoding(wavefile(peaks));
  const { container } = renderAudio();
  const placeholder = Array.from(waveOf(container).children).map(
    (bar) => (bar as HTMLElement).style.height,
  );
  expect(placeholder).toHaveLength(WAVE_BARS);
  expect(new Set(placeholder)).toEqual(new Set(["35%"]));
  expect(waveOf(container).dataset.planAssetWave).toBe("pending");

  await waitFor(() =>
    expect(waveOf(container).dataset.planAssetWave).toBe("decoded"),
  );

  const heights = Array.from(waveOf(container).children).map(
    (bar) => (bar as HTMLElement).style.height,
  );
  expect(heights[0]).toBe("100%");
  expect(heights[1]).toBe("50%");
  expect(Number.parseFloat(heights[2] ?? "")).toBeCloseTo(10, 4);
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("/agent-plan-assets/asset%2F1");
  expect(init.signal).toBeInstanceOf(AbortSignal);
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps the minimum bar height for silence in the decoded waveform", async () => {
  stubDecoding(new Float32Array(10));
  const { container } = renderAudio();
  await waitFor(() =>
    expect(waveOf(container).dataset.planAssetWave).toBe("decoded"),
  );
  const heights = Array.from(waveOf(container).children).map(
    (bar) => (bar as HTMLElement).style.height,
  );
  expect(new Set(heights)).toEqual(new Set(["8%"]));
});

it("does not decode an audio file above the decoding limit", () => {
  const { fetchSpy } = stubDecoding(new Float32Array(10));
  const { container } = renderAudio(
    assetFile({ kind: "audio", size: 25 * MEBIBYTE + 1 }),
  );
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(waveOf(container).dataset.planAssetWave).toBe("pending");
});

it("keeps the placeholder when the audio cannot be decoded", async () => {
  const close = vi.fn(() => Promise.resolve());
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      }),
    ),
  );
  vi.stubGlobal(
    "AudioContext",
    audioContextOf(() => Promise.reject(new Error("bad data")), close),
  );
  const { container } = renderAudio();

  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(waveOf(container).dataset.planAssetWave).toBe("pending");
});

it("keeps the placeholder when the audio request fails", async () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error("offline")));
  vi.stubGlobal("fetch", fetchSpy);
  const { container } = renderAudio();
  await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  expect(waveOf(container).dataset.planAssetWave).toBe("pending");
});

it("aborts the waveform request when the audio preview goes away", () => {
  const signals: AbortSignal[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((...request: [string, RequestInit]) => {
      if (request[1].signal) signals.push(request[1].signal);
      return new Promise(() => undefined);
    }),
  );
  vi.stubGlobal("AudioContext", class {});
  const { unmount } = renderAudio();
  const [signal] = signals;
  expect(signal?.aborted).toBe(false);
  unmount();
  expect(signal?.aborted).toBe(true);
});

it("shows the length of an audio file and reports it", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
  vi.stubGlobal("AudioContext", class {});
  const { container, onFacts } = renderAudio();
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("The audio is missing.");
  expect(audio.className).toContain("hidden");

  defineMediaProperty(audio, "duration", 65);
  fireEvent.loadedMetadata(audio);

  expect(screen.getByText("1:05")).toBeDefined();
  expect(onFacts).toHaveBeenCalledWith({ duration: 65 });
});

it("shows no length for audio of unknown duration", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
  vi.stubGlobal("AudioContext", class {});
  const { container, onFacts } = renderAudio();
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("The audio is missing.");

  defineMediaProperty(audio, "duration", Number.NaN);
  fireEvent.loadedMetadata(audio);

  expect(screen.queryByText(/^\d+:\d{2}$/u)).toBeNull();
  expect(onFacts).toHaveBeenCalledWith({ duration: Number.NaN });
});

it("plays audio only after a click and then reveals its controls", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
  vi.stubGlobal("AudioContext", class {});
  const play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  const { container } = renderAudio();
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("The audio is missing.");

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.asset.play") }),
  );

  expect(play).toHaveBeenCalledTimes(1);
  expect(audio.controls).toBe(true);
  expect(audio.className).not.toContain("hidden");
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.asset.play") }),
  ).toBeNull();
});

it("returns to the play button when the browser refuses to play the audio", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
  vi.stubGlobal("AudioContext", class {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
    new Error("not allowed"),
  );
  const { container } = renderAudio();
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("The audio is missing.");
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.asset.play") }),
  );

  await waitFor(() => expect(audio.controls).toBe(false));
  expect(
    screen.getByRole("button", { name: i18n.t("plans.asset.play") }),
  ).toBeDefined();
});

it("reports audio that cannot be loaded", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
  vi.stubGlobal("AudioContext", class {});
  const { container, onFailure } = renderAudio();
  const audio = container.querySelector("audio");
  if (!audio) throw new Error("The audio is missing.");
  fireEvent.error(audio);
  expect(onFailure).toHaveBeenCalledTimes(1);
});

function pdfFile(
  overrides: Partial<AgentPlanAssetFile> = {},
): AgentPlanAssetFile {
  return assetFile({
    kind: "document",
    fileName: "paper.pdf",
    mediaType: "application/pdf",
    ...overrides,
  });
}

function pdfStub(): {
  render: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
} {
  const render = vi.fn(() => Promise.resolve());
  const close = vi.fn();
  pdfPreview.openPdfPreview.mockResolvedValue({ pageCount: 7, render, close });
  return { render, close };
}

it("shows a page symbol for a document that is not a PDF", () => {
  const { container } = renderTranslated(
    <PlanAssetDocument
      file={assetFile({ kind: "document", mediaType: "text/plain" })}
      onFacts={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  expect(container.querySelector("canvas")).toBeNull();
  expect(pdfPreview.openPdfPreview).not.toHaveBeenCalled();
});

it("shows a page symbol for a PDF above the decoding limit", () => {
  const { container } = renderTranslated(
    <PlanAssetDocument
      file={pdfFile({ size: 25 * MEBIBYTE + 1 })}
      onFacts={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  expect(container.querySelector("canvas")).toBeNull();
  expect(pdfPreview.openPdfPreview).not.toHaveBeenCalled();
});

it("draws the first page of a PDF, reports its page count and closes it", async () => {
  const { render, close } = pdfStub();
  const onFacts = vi.fn();
  const { container } = renderTranslated(
    <PlanAssetDocument
      file={pdfFile()}
      onFacts={onFacts}
      onFailure={vi.fn()}
    />,
  );
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("The canvas is missing.");
  expect(canvas.className).toContain("hidden");

  await waitFor(() => expect(canvas.className).not.toContain("hidden"));

  expect(pdfPreview.openPdfPreview).toHaveBeenCalledWith(
    "/agent-plan-assets/asset%2F1",
    expect.any(AbortSignal),
  );
  expect(onFacts).toHaveBeenCalledWith({ pages: 7 });
  expect(render).toHaveBeenCalledWith(1, canvas, 120);
  expect(close).toHaveBeenCalledTimes(1);
});

it("keeps the page symbol and closes the PDF when drawing fails", async () => {
  const close = vi.fn();
  pdfPreview.openPdfPreview.mockResolvedValue({
    pageCount: 2,
    render: vi.fn(() => Promise.reject(new Error("broken page"))),
    close,
  });
  const { container } = renderTranslated(
    <PlanAssetDocument
      file={pdfFile()}
      onFacts={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(container.querySelector("canvas")?.className).toContain("hidden");
});

it("keeps the page symbol when the PDF cannot be opened", async () => {
  pdfPreview.openPdfPreview.mockRejectedValue(new Error("not a pdf"));
  const { container } = renderTranslated(
    <PlanAssetDocument
      file={pdfFile()}
      onFacts={vi.fn()}
      onFailure={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(pdfPreview.openPdfPreview).toHaveBeenCalledTimes(1),
  );
  expect(container.querySelector("canvas")?.className).toContain("hidden");
});

it("neither reports nor draws a PDF whose preview was left before it opened", async () => {
  let open: (value: unknown) => void = () => undefined;
  pdfPreview.openPdfPreview.mockReturnValue(
    new Promise((resolve) => {
      open = resolve;
    }),
  );
  const render = vi.fn(() => Promise.resolve());
  const close = vi.fn();
  const onFacts = vi.fn();
  const { unmount } = renderTranslated(
    <PlanAssetDocument
      file={pdfFile()}
      onFacts={onFacts}
      onFailure={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(pdfPreview.openPdfPreview).toHaveBeenCalledTimes(1),
  );
  unmount();
  await act(async () => {
    open({ pageCount: 3, render, close });
    await Promise.resolve();
  });

  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  expect(onFacts).not.toHaveBeenCalled();
  expect(render).not.toHaveBeenCalled();
});

it("discards a waveform that was decoded after the audio preview went away", async () => {
  const close = vi.fn(() => Promise.resolve());
  const decoding = vi.fn();
  let finish: (audio: { getChannelData: () => Float32Array }) => void = () =>
    undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1)),
      }),
    ),
  );
  vi.stubGlobal(
    "AudioContext",
    audioContextOf(() => {
      decoding();
      return new Promise((resolve) => {
        finish = resolve;
      });
    }, close),
  );
  const { unmount } = renderAudio();
  await waitFor(() => expect(decoding).toHaveBeenCalledTimes(1));

  unmount();
  await act(async () => {
    finish({ getChannelData: () => new Float32Array(10) });
    await Promise.resolve();
  });

  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
});
