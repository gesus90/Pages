import { expect, it } from "vitest";

import { buildPicaMobilePushMessage } from "@/backend/service/mobile/notifications/PicaMobilePushMessage";

import type {
  PicaMobilePushDetails,
  PicaMobilePushInput,
} from "@/backend/service/mobile/notifications/PicaMobilePushMessage";

const GENERIC = "Unlock to view details.";

function details(
  overrides: Partial<PicaMobilePushDetails> = {},
): PicaMobilePushDetails {
  return {
    planName: "Nightly build",
    steps: [],
    stepCount: 0,
    reason: null,
    ...overrides,
  };
}

function input(
  overrides: Partial<PicaMobilePushInput> = {},
): PicaMobilePushInput {
  return {
    token: "native-token",
    instanceId: "instance-1",
    event: {
      eventId: "event-1",
      accountId: "account-1",
      planId: "plan-1",
      runId: "run-1",
      type: "run_succeeded",
      seq: 7,
      occurredAt: "2026-03-01T12:00:00.000Z",
    },
    locale: "en",
    details: null,
    ttlSeconds: 120,
    ...overrides,
  };
}

function withType(
  type: PicaMobilePushInput["event"]["type"],
  overrides: Partial<PicaMobilePushInput> = {},
): PicaMobilePushInput {
  const base = input();

  return { ...base, event: { ...base.event, type }, ...overrides };
}

it.each([
  ["en", "step_started", "Agent plan: next step"],
  ["en", "run_cancelled", "Agent plan cancelled"],
  ["en", "run_failed", "Agent plan failed"],
  ["en", "run_succeeded", "Agent plan completed successfully"],
  ["de", "step_started", "Agent-Plan: nächster Schritt"],
  ["de", "run_cancelled", "Agent-Plan abgebrochen"],
  ["de", "run_failed", "Agent-Plan fehlgeschlagen"],
  ["de", "run_succeeded", "Agent-Plan erfolgreich abgeschlossen"],
] as const)("titles a generic %s push of %s", (locale, type, title) => {
  const message = buildPicaMobilePushMessage(withType(type, { locale }));

  expect(message.title).toBe(title);
  expect(message.body).toBe(
    locale === "en" ? GENERIC : "Zum Anzeigen der Details entsperren.",
  );
});

it.each([
  ["en", "step_started", "Next step"],
  ["en", "run_cancelled", "Plan cancelled"],
  ["en", "run_failed", "Plan failed"],
  ["en", "run_succeeded", "Plan completed successfully"],
  ["de", "step_started", "Nächster Schritt"],
  ["de", "run_cancelled", "Plan abgebrochen"],
  ["de", "run_failed", "Plan fehlgeschlagen"],
  ["de", "run_succeeded", "Plan erfolgreich abgeschlossen"],
] as const)("titles a detailed %s push of %s", (locale, type, title) => {
  const message = buildPicaMobilePushMessage(
    withType(type, { locale, details: details() }),
  );

  expect(message.title).toBe(title);
  expect(message.body).toBe("Nightly build");
});

it("carries only identifiers in the data and replaces earlier progress by tag", () => {
  const message = buildPicaMobilePushMessage(
    withType("step_started", { details: details() }),
  );

  expect(message.token).toBe("native-token");
  expect(message.ttlSeconds).toBe(120);
  expect(message.channelId).toBe("pica-plan-steps");
  expect(message.tag).toBe("run:run-1:step");
  expect(message.data).toEqual({
    pica_v: "1",
    pica_event: "event-1",
    pica_instance: "instance-1",
    pica_account: "account-1",
    pica_type: "step_started",
    pica_plan: "plan-1",
    pica_run: "run-1",
    pica_seq: "7",
    pica_at: "2026-03-01T12:00:00.000Z",
    tag: "run:run-1:step",
  });
  expect(Object.values(message.data)).not.toContain("Nightly build");
});

it("tags a terminal push with its own event so nothing replaces it", () => {
  const message = buildPicaMobilePushMessage(input());

  expect(message.tag).toBe("event-1");
  expect(message.channelId).toBe("pica-plan-results");
});

it.each([
  [
    "a single step with number and name",
    [{ number: 2, name: "Build" }],
    1,
    "Step 2: Build",
  ],
  [
    "a single step with a number only",
    [{ number: 2, name: null }],
    1,
    "Step 2",
  ],
  [
    "a single step with a blank name",
    [{ number: 3, name: " \n " }],
    1,
    "Step 3",
  ],
  [
    "a single step with a name only",
    [{ number: null, name: "Build" }],
    1,
    "Build",
  ],
  ["a single step that is unknown", [{ number: null, name: null }], 1, ""],
  [
    "several steps",
    [
      { number: 1, name: "A" },
      { number: 2, name: "B" },
    ],
    2,
    "2 steps started",
  ],
  [
    "a count above the named steps",
    [{ number: 1, name: "A" }],
    9,
    "9 steps started",
  ],
  ["no steps", [], 0, ""],
] as const)("words %s", (name, steps, stepCount, addition) => {
  const message = buildPicaMobilePushMessage(
    withType("step_started", {
      details: details({ steps, stepCount }),
    }),
  );

  expect(message.body).toBe(
    addition === "" ? "Nightly build" : `Nightly build · ${addition}`,
  );
});

it("adds the reason only to a failure", () => {
  const reasonDetails = details({ reason: "Out of disk" });

  expect(
    buildPicaMobilePushMessage(
      withType("run_failed", { details: reasonDetails }),
    ).body,
  ).toBe("Nightly build · Out of disk");
  expect(
    buildPicaMobilePushMessage(withType("run_failed", { details: details() }))
      .body,
  ).toBe("Nightly build");
  expect(
    buildPicaMobilePushMessage(
      withType("run_cancelled", { details: reasonDetails }),
    ).body,
  ).toBe("Nightly build");
});

it("sends the generic form when the plan name is empty after cleaning", () => {
  const message = buildPicaMobilePushMessage(
    withType("run_succeeded", { details: details({ planName: " \u0007 " }) }),
  );

  expect(message.title).toBe("Agent plan completed successfully");
  expect(message.body).toBe(GENERIC);
});

it("cleans names and shortens them to eighty characters", () => {
  const message = buildPicaMobilePushMessage(
    withType("step_started", {
      details: details({
        planName: `Plan\u0000   ${"p".repeat(100)}`,
        steps: [{ number: 1, name: "n".repeat(90) }],
        stepCount: 1,
      }),
    }),
  );

  expect(message.body.startsWith(`Plan ${"p".repeat(74)}…`)).toBe(true);
  expect(message.body).toContain(`Step 1: ${"n".repeat(79)}…`);
});

it("shortens the body to two hundred characters", () => {
  const message = buildPicaMobilePushMessage(
    withType("run_failed", {
      details: details({ reason: "r".repeat(300) }),
    }),
  );

  expect(Array.from(message.body)).toHaveLength(200);
  expect(message.body.endsWith("…")).toBe(true);
});

it("falls back to the generic form when the detailed push exceeds the payload limit", () => {
  const crowded = buildPicaMobilePushMessage(
    withType("run_failed", {
      instanceId: "i".repeat(3_600),
      details: details(),
    }),
  );
  const fits = buildPicaMobilePushMessage(
    withType("run_failed", { details: details() }),
  );

  expect(fits.title).toBe("Plan failed");
  expect(crowded.title).toBe("Agent plan failed");
  expect(crowded.body).toBe(GENERIC);
});
