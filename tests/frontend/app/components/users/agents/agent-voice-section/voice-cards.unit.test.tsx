import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { VoiceChoiceCard } from "@/app/components/users/agents/agent-voice-section/voice-choice-card";
import { VoiceSampleCard } from "@/app/components/users/agents/agent-voice-section/voice-sample-card";
import { createI18n } from "@/app/lib/i18n";

import type { VoiceSample } from "@/app/components/users/agents/agent-voice-section/use-voice-sample";

const i18n = createI18n("en");
const model = {
  connectionId: "connection",
  model: "tts",
  name: "Speech",
  voices: ["Alba", "Breeze"],
};

function sample(): VoiceSample {
  return {
    activeVoice: "Alba",
    isLoading: false,
    isPlaying: true,
    progress: 0.5,
    durationSeconds: 65,
    error: null,
    toggle: vi.fn(),
  };
}

it("filters voices, chooses one, plays a preview and changes speed", () => {
  const onVoice = vi.fn();
  const onSpeed = vi.fn();
  const player = sample();
  render(
    <I18nextProvider i18n={i18n}>
      <VoiceChoiceCard
        agentName="Ada"
        model={model}
        missingModelReason="Missing"
        voiceId="Alba"
        effective={{ voiceId: "Alba", missingVoiceId: null }}
        speedTenths={10}
        sample={player}
        canHear
        isDisabled={false}
        onVoice={onVoice}
        onSpeed={onSpeed}
      />
    </I18nextProvider>,
  );
  expect(
    screen
      .getByRole("button", { name: /AlbaChosen/i })
      .getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Breeze" }));
  expect(onVoice).toHaveBeenCalledWith("Breeze");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("agentVoice.hear", { voice: "Breeze" }),
    }),
  );
  expect(player.toggle).toHaveBeenCalledWith({
    voiceId: "Breeze",
    speedTenths: 10,
  });
  fireEvent.change(screen.getByRole("slider"), { target: { value: "13" } });
  expect(onSpeed).toHaveBeenCalledWith(13);
  expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe(
    "1.0×",
  );
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: " breeze " },
  });
  expect(screen.queryByRole("button", { name: /AlbaChosen/i })).toBeNull();
  expect(screen.getByRole("button", { name: "Breeze" })).toBeDefined();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "unknown" },
  });
  expect(screen.getByText(i18n.t("agentVoice.noMatch"))).toBeDefined();
});

it("explains a missing model and permits a typed voice ID when no list exists", () => {
  const onVoice = vi.fn();
  const props = {
    agentName: "Ada",
    missingModelReason: "No model",
    voiceId: "",
    effective: { voiceId: null, missingVoiceId: "old" },
    speedTenths: 10,
    sample: sample(),
    canHear: false,
    isDisabled: true,
    onVoice,
    onSpeed: vi.fn(),
  };
  const view = render(
    <I18nextProvider i18n={i18n}>
      <VoiceChoiceCard {...props} model={null} />
    </I18nextProvider>,
  );
  expect(screen.getByText("No model")).toBeDefined();
  expect(
    screen.getByText(i18n.t("agentVoice.missingVoice", { voice: "old" })),
  ).toBeDefined();
  expect(screen.getByRole("slider").hasAttribute("disabled")).toBe(true);
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <VoiceChoiceCard
        {...props}
        isDisabled={false}
        model={{ ...model, voices: null }}
      />
    </I18nextProvider>,
  );
  fireEvent.change(screen.getByLabelText(i18n.t("agentVoice.voiceId")), {
    target: { value: "custom" },
  });
  expect(onVoice).toHaveBeenCalledWith("custom");
});

it("shows sample duration, errors and blocked state and sends the current selection", () => {
  const player = sample();
  const props = {
    agentName: "Ada",
    sentence: "Hello there",
    voiceId: "Alba",
    speedTenths: 12,
    sample: player,
    canHear: true,
    blockedReason: null,
  };
  const view = render(
    <I18nextProvider i18n={i18n}>
      <VoiceSampleCard {...props} />
    </I18nextProvider>,
  );
  expect(screen.getByText("Hello there")).toBeDefined();
  expect(screen.getByText("1:05")).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("agentVoice.sample.play") }),
  );
  expect(player.toggle).toHaveBeenCalledWith({
    voiceId: "Alba",
    speedTenths: 12,
  });
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <VoiceSampleCard
        {...props}
        voiceId="Breeze"
        canHear={false}
        blockedReason="Unavailable"
        sample={{ ...player, error: "request" }}
      />
    </I18nextProvider>,
  );
  expect(screen.getByText("0:00")).toBeDefined();
  expect(screen.getByText("Unavailable")).toBeDefined();
  expect(screen.getByRole("alert").textContent).toBe(
    i18n.t("agentVoice.error.request"),
  );
  expect(
    screen
      .getByRole("button", { name: i18n.t("agentVoice.sample.play") })
      .hasAttribute("disabled"),
  ).toBe(true);
});
