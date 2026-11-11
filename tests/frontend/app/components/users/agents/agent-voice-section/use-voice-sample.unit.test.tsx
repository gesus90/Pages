import { act, renderHook, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import { useVoiceSample } from "@/app/components/users/agents/agent-voice-section/use-voice-sample";
import { createI18n } from "@/app/lib/i18n";

import type { ReactNode } from "react";

const i18n = createI18n("en");

function Wrapper({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads, plays and caches a sample for its voice and speed", async () => {
  const audio = document.createElement("audio");
  const play = vi.spyOn(audio, "play").mockResolvedValue();
  vi.spyOn(audio, "pause").mockImplementation(() => {});
  vi.stubGlobal(
    "Audio",
    vi.fn(function () {
      return audio;
    }),
  );
  const revoke = vi.fn();
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:sample"),
    revokeObjectURL: revoke,
  });
  const fetchSample = vi.fn().mockResolvedValue(
    new Response(new Blob(["audio"]), {
      headers: { "X-Pages-Playback-Rate": "1.5" },
    }),
  );
  vi.stubGlobal("fetch", fetchSample);
  const { result, unmount } = renderHook(() => useVoiceSample("agent / one"), {
    wrapper: Wrapper,
  });
  const request = { voiceId: "Alba", speedTenths: 15 };
  act(() => result.current.toggle(request));
  await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
  expect(fetchSample).toHaveBeenCalledWith(
    "/users-api/agent-voice/agent%20%2F%20one",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ ...request, language: "en" }),
    }),
  );
  expect(audio.playbackRate).toBe(1.5);
  expect(result.current.activeVoice).toBe("Alba");
  act(() => result.current.toggle(request));
  await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
  expect(fetchSample).toHaveBeenCalledTimes(1);
  unmount();
  expect(revoke).toHaveBeenCalledWith("blob:sample");
});

it("reports a server refusal and allows a retry", async () => {
  const audio = document.createElement("audio");
  vi.spyOn(audio, "play").mockResolvedValue();
  vi.spyOn(audio, "pause").mockImplementation(() => {});
  vi.stubGlobal(
    "Audio",
    vi.fn(function () {
      return audio;
    }),
  );
  const fetchSample = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "unavailable" }), { status: 400 }),
    )
    .mockRejectedValueOnce(new Error("offline"));
  vi.stubGlobal("fetch", fetchSample);
  const { result } = renderHook(() => useVoiceSample("agent"), {
    wrapper: Wrapper,
  });
  const request = { voiceId: null, speedTenths: 10 };
  act(() => result.current.toggle(request));
  await waitFor(() => expect(result.current.error).toBe("unavailable"));
  act(() => result.current.toggle(request));
  await waitFor(() => expect(result.current.error).toBe("request"));
  expect(fetchSample).toHaveBeenCalledTimes(2);
});

it("does not request a sample for an unsaved agent", () => {
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const fetchSample = vi.fn();
  vi.stubGlobal("fetch", fetchSample);
  const { result } = renderHook(() => useVoiceSample(null), {
    wrapper: Wrapper,
  });
  act(() => result.current.toggle({ voiceId: null, speedTenths: 10 }));
  expect(fetchSample).not.toHaveBeenCalled();
  expect(result.current.activeVoice).toBeUndefined();
});
