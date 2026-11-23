import { expect, it, vi } from "vitest";

import {
  LIVE_CHANGE_CHANNEL,
  LiveChangeNotificationRepository,
} from "./LiveChangeNotificationRepository";

import type { Database } from "@/backend/database/Database";

it("notifies the live change channel with the payload", async () => {
  const execute = vi.fn<Database["execute"]>(async () => {});
  await new LiveChangeNotificationRepository({
    execute,
  } as unknown as Database).notify("{}");
  expect(execute.mock.calls[0]?.[1]).toEqual({
    channel: LIVE_CHANGE_CHANNEL,
    payload: "{}",
  });
});
