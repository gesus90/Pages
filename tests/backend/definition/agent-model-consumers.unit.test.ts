import { expect, it } from "vitest";

import { AGENT_EMPLOYEE_ACCESS_MODES } from "@/definition/AgentEmployee";
import { modelConsumerRefusal } from "@/definition/AgentModelConsumers";

const zen = {
  provider: "opencode",
  model: "opencode/free",
  isFree: true,
  isToolCapable: true,
} as const;

it.each(AGENT_EMPLOYEE_ACCESS_MODES)(
  "uses the employee's %s access instead of Pica's read-only restriction",
  (employeeAccess) => {
    expect(modelConsumerRefusal("employee", zen, { employeeAccess })).toBe(
      employeeAccess === "read_only" ? "employeeToolsMissing" : null,
    );
    expect(modelConsumerRefusal("pica", zen, { employeeAccess })).toBe(
      "zenToolsMissing",
    );
    expect(modelConsumerRefusal("plan", zen, { employeeAccess })).toBeNull();
  },
);

it("grants no host tools when employee access is omitted", () => {
  expect(modelConsumerRefusal("employee", zen)).toBe("employeeToolsMissing");
});

it.each(["pica", "employee"] as const)(
  "keeps API providers refused for %s",
  (consumer) => {
    expect(
      modelConsumerRefusal(
        consumer,
        { ...zen, provider: "openai" },
        { employeeAccess: "yolo" },
      ),
    ).toBe("noChatAdapter");
  },
);

it("keeps plan rules and speech domain rules unchanged", () => {
  expect(modelConsumerRefusal("plan", { ...zen, isToolCapable: false })).toBe(
    "noToolCalls",
  );
  expect(
    modelConsumerRefusal("plan", { ...zen, isSpeechOutputCapable: true }),
  ).toBe("speechOutputOnly");
  expect(
    modelConsumerRefusal("plan", { ...zen, isTranscriptionOnly: true }),
  ).toBe("transcriptionOnly");
  expect(modelConsumerRefusal("stt", zen)).toBe("noSpeech");
  expect(modelConsumerRefusal("tts", zen)).toBe("noSpeechOutput");
});

it("keeps formerly hidden non-chat models refused and preserves simulated plan models", () => {
  expect(modelConsumerRefusal("plan", { ...zen, isChatCapable: false })).toBe(
    "noChat",
  );
  expect(
    modelConsumerRefusal("plan", {
      ...zen,
      isToolCapable: false,
      isSimulation: true,
    }),
  ).toBeNull();
});
