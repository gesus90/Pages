import { expect, it } from "vitest";

import {
  classifyKeyFailure,
  classifySshFailure,
} from "@/backend/remote/SshFailure";

import { partial } from "../../app/lib/service-wiring-fakes";

import type { SshProcessResult } from "@/backend/remote/SshProcess";

const failed = partial<SshProcessResult>({
  exitCode: 255,
  stderr: "",
  isUnavailable: false,
  isTimedOut: false,
});

it.each([
  ["Host key verification failed", "host_key_changed"],
  ["Could not resolve hostname", "host_unknown"],
  ["Connection refused", "unreachable_refused"],
  ["No route to host", "unreachable_network"],
  ["bad passphrase", "passphrase_wrong"],
  ["invalid format", "key_invalid"],
  ["Connection timed out", "unreachable_timeout"],
  ["Connection reset", "transport_lost"],
  ["other", "remote_failed"],
] as const)(
  "classifies SSH failures without exposing diagnostic text",
  (stderr, expected) => {
    expect(classifySshFailure({ ...failed, stderr }, "password")).toBe(
      expected,
    );
  },
);

it("distinguishes unavailable, timed-out and rejected credentials", () => {
  expect(
    classifySshFailure({ ...failed, isUnavailable: true }, "password"),
  ).toBe("ssh_unavailable");
  expect(classifySshFailure({ ...failed, isTimedOut: true }, "password")).toBe(
    "unreachable_timeout",
  );
  expect(classifySshFailure({ ...failed, exitCode: 1 }, "password")).toBeNull();
  expect(
    classifySshFailure({ ...failed, stderr: "Permission denied" }, "password"),
  ).toBe("password_rejected");
  expect(
    classifySshFailure({ ...failed, stderr: "Permission denied" }, "key"),
  ).toBe("key_rejected");
});

it("distinguishes key parsing and passphrase failures", () => {
  expect(classifyKeyFailure({ ...failed, exitCode: 0 }, "key")).toBeNull();
  expect(
    classifyKeyFailure({ ...failed, stderr: "bad passphrase" }, "key"),
  ).toBe("passphrase_required");
  expect(
    classifyKeyFailure(
      { ...failed, stderr: "bad passphrase" },
      "key_passphrase",
    ),
  ).toBe("passphrase_wrong");
  expect(classifyKeyFailure(failed, "key")).toBe("key_invalid");
});
