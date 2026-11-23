import { expect, it } from "vitest";

import {
  LocalControlCommandError,
  LocalControlFailure,
  localControlFailureCode,
  safeLocalControlCode,
} from "@/backend/agents/local/LocalControlFailure";
import { AgentError } from "@/backend/error/AgentErrors";

it("keeps the fixed diagnosis of a protocol rejection", () => {
  const failure = new LocalControlFailure("stale_attachment");
  expect(failure.code).toBe("stale_attachment");
  expect(failure.message).toBe("stale_attachment");
});

it.each([
  ["plan_session_unavailable", "plan_session_unavailable"],
  ["stale_attachment", "stale_attachment"],
  ["native_cleanup_unconfirmed", "native_cleanup_unconfirmed"],
  ["unknown_code", "internal"],
  ["Bad-Code", "internal"],
  ["", "internal"],
  ["a".repeat(65), "internal"],
])("maps the code %s to %s", (code, expected) => {
  expect(safeLocalControlCode(code)).toBe(expected);
});

it("rejects a code that is not a string", () => {
  expect(safeLocalControlCode(42)).toBe("internal");
});

it("retains only the validated diagnosis of a failed command", () => {
  const error = new LocalControlCommandError("stale_attachment");
  expect(error.code).toBe("plan_local_control_failed");
  expect(error.detail).toBe("stale_attachment");
  expect(new LocalControlCommandError("secret text").detail).toBe("internal");
});

it("translates only known error types", () => {
  expect(
    localControlFailureCode(new AgentError("plan_session_unavailable")),
  ).toBe("plan_session_unavailable");
  expect(
    localControlFailureCode(
      new LocalControlFailure("native_cleanup_unconfirmed"),
    ),
  ).toBe("native_cleanup_unconfirmed");
  expect(localControlFailureCode(new Error("plan_session_unavailable"))).toBe(
    "internal",
  );
  expect(localControlFailureCode("stale_attachment")).toBe("internal");
});
