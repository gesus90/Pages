import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  PlanAssetPreview,
  usePlanAssetAccess,
} from "@/app/components/agents/plans/plan-node-card/plan-asset-preview";

import { i18n, renderTranslated } from "../plan-flow-fixture";

import type * as PlanAssetUpload from "@/app/lib/plan-asset-upload";
import type { PlanAssetAccess } from "@/app/components/agents/plans/plan-node-card/plan-asset-preview";
import type { PlanAssetUploadState } from "@/app/components/agents/plans/plan-node-card/use-plan-asset-upload";
import type { AgentPlanAssetFile } from "@/definition/AgentPlanAsset";

const upload = vi.hoisted(() => ({ checkPlanAsset: vi.fn() }));

vi.mock("@/app/lib/plan-asset-upload", async (importOriginal) => ({
  ...(await importOriginal<typeof PlanAssetUpload>()),
  checkPlanAsset: upload.checkPlanAsset,
}));

const IDLE: PlanAssetUploadState = { kind: "idle" };

function assetFile(
  overrides: Partial<AgentPlanAssetFile> = {},
): AgentPlanAssetFile {
  return {
    assetId: "asset-1",
    fileName: "photo.png",
    mediaType: "image/png",
    kind: "image",
    size: 2048,
    digest: "a".repeat(64),
    ...overrides,
  };
}

interface PreviewOptions {
  readonly file?: AgentPlanAssetFile | null;
  readonly upload?: PlanAssetUploadState;
  readonly access?: PlanAssetAccess;
}

function renderPreview(options: PreviewOptions = {}): {
  frame: HTMLElement;
  onFacts: ReturnType<typeof vi.fn>;
  onFailure: ReturnType<typeof vi.fn>;
} {
  const onFacts = vi.fn();
  const onFailure = vi.fn();
  const { container } = renderTranslated(
    <PlanAssetPreview
      file={options.file === undefined ? assetFile() : options.file}
      upload={options.upload ?? IDLE}
      access={options.access ?? "readable"}
      onFacts={onFacts}
      onFailure={onFailure}
    />,
  );
  const frame = container.querySelector<HTMLElement>(
    "[data-plan-asset-preview]",
  );
  if (!frame) throw new Error("The preview frame is missing.");
  return { frame, onFacts, onFailure };
}

beforeEach(() => {
  upload.checkPlanAsset.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("invites a drop on a card that has no file yet", () => {
  const { frame } = renderPreview({ file: null });
  expect(frame.dataset.planAssetPreview).toBe("drop");
  expect(frame.textContent).toBe(i18n.t("plans.asset.dropOrChoose"));
});

it("shows the drop target while a file is dragged over, even above an existing file", () => {
  const { frame } = renderPreview({ upload: { kind: "dragging" } });
  expect(frame.dataset.planAssetPreview).toBe("drop");
  expect(frame.textContent).toBe(i18n.t("plans.asset.dropHere"));
  expect(screen.queryByRole("img")).toBeNull();
});

it("shows the share, the sent bytes and the size of a running upload", () => {
  const { frame } = renderPreview({
    upload: {
      kind: "uploading",
      fileName: "big.bin",
      size: 2 * 1024 * 1024,
      share: 0.25,
    },
  });

  expect(frame.dataset.planAssetPreview).toBe("plain");
  expect(screen.getByRole("status").textContent).toContain("25 %");
  const progress = screen.getByRole("progressbar", {
    name: i18n.t("plans.asset.uploading", { name: "big.bin" }),
  });
  expect(progress.getAttribute("value")).toBe("25");
  expect(frame.textContent).toContain(
    i18n.t("plans.asset.uploaded", { sent: "512 KiB", size: "2 MiB" }),
  );
});

it("names the reason of a refused upload in a red frame", () => {
  const { frame } = renderPreview({
    upload: { kind: "failed", fileName: "big.bin", code: "networkError" },
  });
  expect(frame.dataset.planAssetPreview).toBe("error");
  expect(frame.textContent).toBe(
    i18n.t("settings.agents.error.networkError", {
      defaultValue: i18n.t("plans.asset.uploadFailed"),
    }),
  );
});

it("falls back to the general message for an unknown refusal code", () => {
  const { frame } = renderPreview({
    upload: { kind: "failed", fileName: "big.bin", code: "no-such-code" },
  });
  expect(frame.textContent).toBe(i18n.t("plans.asset.uploadFailed"));
});

it.each(["missing", "unreadable", "changed"] as const)(
  "shows a red frame with the %s notice for a file that cannot be read",
  (access) => {
    const { frame } = renderPreview({ access });
    expect(frame.dataset.planAssetPreview).toBe("error");
    expect(frame.textContent).toBe(i18n.t(`plans.asset.access.${access}`));
    expect(screen.queryByRole("img")).toBeNull();
  },
);

it("says that the file is being checked before it shows a preview", () => {
  const { frame } = renderPreview({ access: "checking" });
  expect(frame.dataset.planAssetPreview).toBe("plain");
  expect(frame.textContent).toBe(i18n.t("plans.asset.checking"));
  expect(screen.queryByRole("img")).toBeNull();
});

it.each(["archive", "other"] as const)(
  "shows no preview for a readable %s file",
  (kind) => {
    const { frame } = renderPreview({
      file: assetFile({ kind, mediaType: "application/zip" }),
    });
    expect(frame.textContent).toBe(i18n.t("plans.asset.noPreview"));
  },
);

it("draws the image of a readable image file and passes its facts on", () => {
  const { onFacts, onFailure } = renderPreview();
  const image = screen.getByRole("img", { name: "photo.png" });

  Object.defineProperty(image, "naturalWidth", { value: 30 });
  Object.defineProperty(image, "naturalHeight", { value: 20 });
  fireEvent.load(image);
  fireEvent.error(image);

  expect(onFacts).toHaveBeenCalledWith({
    dimensions: { width: 30, height: 20 },
  });
  expect(onFailure).toHaveBeenCalledTimes(1);
});

it("draws the poster of a readable video", () => {
  const { frame } = renderPreview({
    file: assetFile({ kind: "video", mediaType: "video/mp4" }),
  });
  expect(frame.querySelector("video")?.getAttribute("src")).toBe(
    "/agent-plan-assets/asset-1#t=0.1",
  );
  expect(
    screen.getByRole("button", { name: i18n.t("plans.asset.play") }),
  ).toBeDefined();
});

it("draws the waveform placeholder of a readable audio file", () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => undefined)),
  );
  vi.stubGlobal("AudioContext", class {});
  const { frame } = renderPreview({
    file: assetFile({ kind: "audio", mediaType: "audio/mpeg" }),
  });
  expect(frame.querySelector("audio")).not.toBeNull();
  expect(
    frame
      .querySelector("[data-plan-asset-wave]")
      ?.getAttribute("data-plan-asset-wave"),
  ).toBe("pending");
});

it("draws the page symbol of a readable plain document", () => {
  const { frame } = renderPreview({
    file: assetFile({ kind: "document", mediaType: "text/plain" }),
  });
  expect(frame.dataset.planAssetPreview).toBe("plain");
  expect(frame.querySelector("canvas")).toBeNull();
  expect(frame.querySelector("svg")).not.toBeNull();
});

it("lets an upload state take precedence over the file's access state", () => {
  const { frame } = renderPreview({
    access: "missing",
    upload: { kind: "dragging" },
  });
  expect(frame.textContent).toBe(i18n.t("plans.asset.dropHere"));
});

it("keeps checking state without a request while there is no file", () => {
  const { result } = renderHook(() => usePlanAssetAccess(null));
  expect(result.current.access).toBe("checking");
  expect(upload.checkPlanAsset).not.toHaveBeenCalled();
});

it("asks once for the access of a file and reports what the check answered", async () => {
  upload.checkPlanAsset.mockResolvedValue("readable");
  const file = assetFile();
  const { result } = renderHook(() => usePlanAssetAccess(file));
  expect(result.current.access).toBe("checking");

  await waitFor(() => expect(result.current.access).toBe("readable"));
  expect(upload.checkPlanAsset).toHaveBeenCalledTimes(1);
  expect(upload.checkPlanAsset).toHaveBeenCalledWith(
    { assetId: "asset-1", digest: "a".repeat(64) },
    expect.any(AbortSignal),
  );
});

it("reports a changed file as the check found it", async () => {
  upload.checkPlanAsset.mockResolvedValue("changed");
  const { result } = renderHook(() => usePlanAssetAccess(assetFile()));
  await waitFor(() => expect(result.current.access).toBe("changed"));
});

it("takes a file whose check failed as missing", async () => {
  upload.checkPlanAsset.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => usePlanAssetAccess(assetFile()));
  await waitFor(() => expect(result.current.access).toBe("missing"));
});

it("keeps a failure the preview found itself", async () => {
  upload.checkPlanAsset.mockResolvedValue("readable");
  const { result } = renderHook(() => usePlanAssetAccess(assetFile()));
  await waitFor(() => expect(result.current.access).toBe("readable"));

  act(() => result.current.fail());

  expect(result.current.access).toBe("unreadable");
});

it("checks again from the start when another file replaces the first", async () => {
  upload.checkPlanAsset.mockResolvedValueOnce("readable");
  const first = assetFile();
  const { result, rerender } = renderHook(
    ({ file }) => usePlanAssetAccess(file),
    { initialProps: { file: first } },
  );
  await waitFor(() => expect(result.current.access).toBe("readable"));

  upload.checkPlanAsset.mockReturnValueOnce(new Promise(() => undefined));
  rerender({ file: assetFile({ assetId: "asset-2", digest: "b".repeat(64) }) });

  await waitFor(() => expect(result.current.access).toBe("checking"));
  expect(upload.checkPlanAsset).toHaveBeenLastCalledWith(
    { assetId: "asset-2", digest: "b".repeat(64) },
    expect.any(AbortSignal),
  );
});

it("ignores the answer of a check that a newer file has replaced", async () => {
  let answerFirst: (access: PlanAssetAccess) => void = () => undefined;
  upload.checkPlanAsset.mockReturnValueOnce(
    new Promise<PlanAssetAccess>((resolve) => {
      answerFirst = resolve;
    }),
  );
  const { result, rerender } = renderHook(
    ({ file }) => usePlanAssetAccess(file),
    { initialProps: { file: assetFile() } },
  );
  upload.checkPlanAsset.mockReturnValueOnce(new Promise(() => undefined));
  rerender({ file: assetFile({ assetId: "asset-2" }) });

  await act(async () => {
    answerFirst("readable");
    await Promise.resolve();
  });

  expect(result.current.access).toBe("checking");
});

it("ignores a failed check of a file that was replaced", async () => {
  let failFirst: (reason: Error) => void = () => undefined;
  upload.checkPlanAsset.mockReturnValueOnce(
    new Promise<PlanAssetAccess>((...callbacks) => {
      failFirst = callbacks[1];
    }),
  );
  const { result, rerender } = renderHook(
    ({ file }) => usePlanAssetAccess(file),
    { initialProps: { file: assetFile() } },
  );
  upload.checkPlanAsset.mockReturnValueOnce(new Promise(() => undefined));
  rerender({ file: assetFile({ assetId: "asset-2" }) });

  await act(async () => {
    failFirst(new Error("offline"));
    await Promise.resolve();
  });

  expect(result.current.access).toBe("checking");
});
