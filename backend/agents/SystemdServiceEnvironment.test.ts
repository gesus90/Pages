import { expect, it } from "vitest";

import { omitSystemdServiceEnvironment } from "@/backend/agents/SystemdServiceEnvironment";

it("drops systemd owned variables and undefined entries but keeps the rest", () => {
  const result = omitSystemdServiceEnvironment({
    INVOCATION_ID: "id",
    NOTIFY_SOCKET: "/run/notify",
    LISTEN_FDS: "1",
    PATH: "/usr/bin",
    HOME: "/home/user",
    UNSET: undefined,
  });

  expect(result).toEqual({ PATH: "/usr/bin", HOME: "/home/user" });
});
