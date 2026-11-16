import { expect, it, vi } from "vitest";

import {
  recordAccountAuthorizationVersion,
  withAccountAuthorizationLog,
} from "@/backend/logging/AccountAuthorizationLog";
import { logEvent } from "@/backend/logging/Logger";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

it("logs a changed authorization version only after successful delivery", () => {
  recordAccountAuthorizationVersion("outside", "ignored");
  withAccountAuthorizationLog((confirm) => {
    recordAccountAuthorizationVersion("person", "first");
    confirm();
    confirm();
  });
  withAccountAuthorizationLog(() => {
    recordAccountAuthorizationVersion("person", "unconfirmed");
  });
  expect(logEvent).not.toHaveBeenCalled();
  withAccountAuthorizationLog((confirm) => {
    recordAccountAuthorizationVersion("person", "second");
    confirm();
  });
  expect(logEvent).toHaveBeenCalledOnce();
  expect(logEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "account.authorization.changed",
      metadata: { userId: "person" },
    }),
  );
  expect(JSON.stringify(vi.mocked(logEvent).mock.calls)).not.toContain(
    "second",
  );
});
