import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

const made = vi.hoisted<{ dispatcher: unknown }>(() => ({ dispatcher: null }));

function stub(name: string): Record<string, Mock> {
  return {
    [name]: vi.fn(function (this: object, ...args: unknown[]) {
      Object.assign(this, { name, args });
    }),
  };
}

vi.mock("@/backend/database/repositories/SessionRepository", () =>
  stub("SessionRepository"),
);
vi.mock(
  "@/backend/database/repositories/mobile/PicaMobileNotificationDeliveryRepository",
  () => stub("PicaMobileNotificationDeliveryRepository"),
);
vi.mock(
  "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository",
  () => ({
    ...stub("PicaMobileNotificationEventRepository"),
    createNotificationEventId: () => "event-id",
  }),
);
vi.mock(
  "@/backend/database/repositories/mobile/PicaMobileNotificationPreferenceRepository",
  () => stub("PicaMobileNotificationPreferenceRepository"),
);
vi.mock(
  "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository",
  () => stub("PicaMobilePushRegistrationRepository"),
);
vi.mock("@/backend/service/mobile/notifications/PicaMobilePushSenders", () => ({
  createPicaMobilePushSender: vi.fn(() => "sender"),
}));
vi.mock("@/backend/service/mobile/notifications/PicaMobileAccountChecks", () =>
  stub("PagesPicaMobileAccountChecks"),
);
vi.mock(
  "@/backend/service/mobile/notifications/PicaMobileNotificationAccess",
  () => stub("PicaMobileNotificationAccess"),
);
vi.mock(
  "@/backend/service/mobile/notifications/PicaMobileNotificationDispatcher",
  () => ({
    PicaMobileNotificationDispatcher: vi.fn(function (
      this: object,
      input: unknown,
    ) {
      made.dispatcher = input;
      Object.assign(this, { input });
    }),
  }),
);
vi.mock(
  "@/backend/service/mobile/notifications/PicaMobileNotificationSettings",
  () => ({
    readPicaMobileNotificationSettings: vi.fn(() => ({
      fcmServiceAccountFile: "f.json",
    })),
  }),
);
vi.mock("@/backend/service/mobile/notifications/PicaMobilePushTokenVault", () =>
  stub("PicaMobilePushTokenVault"),
);
vi.mock("./IntegrationProcessing", () => ({
  canProcessIntegrations: () => true,
}));

import { PicaMobileNotificationEventRepository } from "@/backend/database/repositories/mobile/PicaMobileNotificationEventRepository";

import { createIntegrationFcmConsumer } from "./IntegrationFcmConsumer";

describe("createIntegrationFcmConsumer", () => {
  it("wires the dispatcher", () => {
    const readInstanceId = vi.fn(() => "instance");
    vi.mocked(PicaMobileNotificationEventRepository).mockImplementation(
      function (this: object) {
        Object.assign(this, { readInstanceId });
      },
    );
    createIntegrationFcmConsumer({
      database: {} as unknown as never,
      config: {} as unknown as never,
      tokenKey: Buffer.alloc(32),
      users: {} as unknown as never,
      runs: {} as unknown as never,
    });
    const input = made.dispatcher as {
      sender: string;
      canDispatch: () => boolean;
      instanceId: () => string;
    };
    expect(input.sender).toBe("sender");
    expect(input.canDispatch()).toBe(true);
    expect(input.instanceId()).toBe("instance");
    expect(readInstanceId).toHaveBeenCalledWith("event-id");
  });
});
