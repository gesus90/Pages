import { expect, it } from "vitest";

import {
  BROWSER_CONNECTIONS_PER_ACCOUNT,
  PicaMobileConversationPresence,
} from "@/backend/service/mobile/conversations/PicaMobileConversationPresence";
import {
  PRESENCE_HEARTBEAT_WINDOW_MILLISECONDS,
  PRESENCE_HEARTBEATS_PER_WINDOW,
  PresenceHeartbeatLimit,
} from "@/backend/service/mobile/conversations/PresenceHeartbeatLimit";

it("removes expired heartbeat windows of accounts that stopped sending", () => {
  let now = 0;
  const limit = new PresenceHeartbeatLimit(() => now);
  for (let index = 0; index < 50; index += 1)
    expect(limit.permit(`account-${index}`)).toBe(true);
  expect(limit.size).toBe(50);
  now = PRESENCE_HEARTBEAT_WINDOW_MILLISECONDS;
  expect(limit.permit("account-active")).toBe(true);
  expect(limit.size).toBe(1);
});

it("still refuses heartbeats beyond the limit within one window", () => {
  let now = 0;
  const limit = new PresenceHeartbeatLimit(() => now);
  for (let index = 0; index < PRESENCE_HEARTBEATS_PER_WINDOW; index += 1)
    expect(limit.permit("account")).toBe(true);
  expect(limit.permit("account")).toBe(false);
  now = PRESENCE_HEARTBEAT_WINDOW_MILLISECONDS;
  expect(limit.permit("account")).toBe(true);
});

it("keeps at most 20 browser tabs per account and pushes out the one renewed longest ago", () => {
  let now = 0;
  const presence = new PicaMobileConversationPresence(() => now);
  for (let index = 0; index < BROWSER_CONNECTIONS_PER_ACCOUNT; index += 1) {
    presence.setBrowser(
      "account",
      `tab-${index}`,
      `group:c${index}`,
      `c${index}`,
    );
    now += 1;
  }
  presence.setBrowser("account", "tab-0", "group:c0", "c0");
  presence.setBrowser("account", "tab-new", "group:new", "new");
  expect(presence.browserConnectionCount("account")).toBe(20);
  expect(presence.isOpen("account", "c0")).toBe(true);
  expect(presence.isOpen("account", "c1")).toBe(false);
  expect(presence.isOpen("account", "new")).toBe(true);
  expect(presence.browserConnectionCount("other")).toBe(0);
});

it("drops expired browser tabs on the next heartbeat of the account without a read", () => {
  let now = 0;
  const presence = new PicaMobileConversationPresence(() => now);
  presence.setBrowser("account", "tab-1", "group:a", "a");
  presence.setBrowser("account", "tab-2", "group:b", "b");
  now = 45_000;
  presence.setBrowser("account", "tab-3", "group:c", "c");
  expect(presence.browserConnectionCount("account")).toBe(1);
  presence.setBrowser("account", "tab-3", null, null);
  expect(presence.browserConnectionCount("account")).toBe(0);
});
