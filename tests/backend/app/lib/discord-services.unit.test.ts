import { beforeEach, expect, it, vi } from "vitest";

import { createDiscordServices } from "@/app/lib/discord-services.server";
import { DiscordAttemptRepository } from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import { DiscordConnectionRepository } from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import { DiscordDeliveryRepository } from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import { DiscordApiClient } from "@/backend/discord/DiscordApiClient";
import {
  describeDiscordInstance,
  readDiscordApplication,
} from "@/backend/discord/DiscordConfig";
import { DiscordAuthorizationService } from "@/backend/service/discord/DiscordAuthorizationService";
import { DiscordChannelCatalog } from "@/backend/service/discord/DiscordChannelCatalog";
import { DiscordConnectionService } from "@/backend/service/discord/DiscordConnectionService";
import { DiscordDeliveryScheduler } from "@/backend/service/discord/DiscordDeliveryScheduler";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { DiscordDeliveryWorker } from "@/backend/service/discord/DiscordDeliveryWorker";
import { DiscordNotificationService } from "@/backend/service/discord/DiscordNotificationService";
import { DiscordSubjectLookup } from "@/backend/service/discord/DiscordSubjectLookup";

import type { DiscordServiceContext } from "@/app/lib/discord-services.server";
import type { DiscordApplication } from "@/backend/discord/DiscordConfig";

const { fakeClasses, opaque } = await vi.hoisted(
  async () => import("./service-wiring-fakes"),
);

vi.mock(
  "@/backend/database/repositories/discord/DiscordAttemptRepository",
  () => fakeClasses({ DiscordAttemptRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/discord/DiscordConnectionRepository",
  () => fakeClasses({ DiscordConnectionRepository: [] }),
);
vi.mock(
  "@/backend/database/repositories/discord/DiscordDeliveryRepository",
  () => fakeClasses({ DiscordDeliveryRepository: [] }),
);
vi.mock("@/backend/discord/DiscordApiClient", () =>
  fakeClasses({ DiscordApiClient: [] }),
);
vi.mock("@/backend/discord/DiscordConfig", () => ({
  describeDiscordInstance: vi.fn(),
  readDiscordApplication: vi.fn(),
}));
vi.mock("@/backend/service/discord/DiscordAuthorizationService", () =>
  fakeClasses({ DiscordAuthorizationService: [] }),
);
vi.mock("@/backend/service/discord/DiscordChannelCatalog", () =>
  fakeClasses({ DiscordChannelCatalog: [] }),
);
vi.mock("@/backend/service/discord/DiscordConnectionService", () =>
  fakeClasses({ DiscordConnectionService: [] }),
);
vi.mock("@/backend/service/discord/DiscordDeliveryScheduler", () =>
  fakeClasses({ DiscordDeliveryScheduler: ["kick", "start", "stop"] }),
);
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
vi.mock("@/backend/service/discord/DiscordDeliveryWorker", () =>
  fakeClasses({ DiscordDeliveryWorker: [] }),
);
vi.mock("@/backend/service/discord/DiscordNotificationService", () =>
  fakeClasses({ DiscordNotificationService: ["listen"] }),
);
vi.mock("@/backend/service/discord/DiscordSubjectLookup", () =>
  fakeClasses({ DiscordSubjectLookup: [] }),
);

const APPLICATION: DiscordApplication = {
  applicationId: "application-1",
  clientSecret: "synthetic-secret",
  botToken: "synthetic-token",
};
const CONTEXT: DiscordServiceContext = {
  database: opaque("database"),
  projectService: opaque("project service"),
  projectRepository: opaque("project repository"),
  taskRepository: opaque("task repository"),
  events: opaque("events"),
};

beforeEach(() => {
  vi.resetAllMocks();
  globalThis.pagesDiscordSchedulerStarted = undefined;
  vi.mocked(describeDiscordInstance).mockReturnValue(opaque("instance"));
});

it("only explains what is missing without a Discord application", () => {
  vi.mocked(readDiscordApplication).mockReturnValue(null);

  const services = createDiscordServices(CONTEXT);

  expect(vi.mocked(DiscordApiClient)).not.toHaveBeenCalled();
  expect(vi.mocked(DiscordAuthorizationService).mock.calls[0][0]).toEqual({
    attempts: vi.mocked(DiscordAttemptRepository).mock.instances[0],
    runtime: null,
  });
  expect(vi.mocked(DiscordConnectionService).mock.calls[0][0]).toEqual({
    activity: CONTEXT.projectRepository,
    authorization: services.discordAuthorizationService,
    catalog: null,
    connections: vi.mocked(DiscordConnectionRepository).mock.instances[0],
    deliveries: vi.mocked(DiscordDeliveryRepository).mock.instances[0],
    instance: opaque("instance"),
    projects: CONTEXT.projectService,
    sender: null,
  });
  expect(vi.mocked(DiscordNotificationService)).not.toHaveBeenCalled();
  expect(vi.mocked(DiscordDeliveryScheduler)).not.toHaveBeenCalled();
  expect(registerShutdownTask).not.toHaveBeenCalled();
  expect(globalThis.pagesDiscordSchedulerStarted).toBe(undefined);
});

it("connects projects with the client and channel catalog of the application", () => {
  vi.mocked(readDiscordApplication).mockReturnValue(APPLICATION);

  const services = createDiscordServices(CONTEXT);

  const [client] = vi.mocked(DiscordApiClient).mock.instances;
  expect(vi.mocked(DiscordApiClient).mock.calls).toEqual([[APPLICATION]]);
  expect(vi.mocked(DiscordAuthorizationService).mock.calls[0][0]).toEqual({
    attempts: vi.mocked(DiscordAttemptRepository).mock.instances[0],
    runtime: { application: APPLICATION, client },
  });
  expect(services.discordAuthorizationService).toBe(
    vi.mocked(DiscordAuthorizationService).mock.instances[0],
  );
  expect(vi.mocked(DiscordChannelCatalog).mock.calls).toEqual([
    [client, "application-1"],
  ]);
  const [options] = vi.mocked(DiscordConnectionService).mock.calls[0];
  expect(options.catalog).toBe(
    vi.mocked(DiscordChannelCatalog).mock.instances[0],
  );
  expect(options.sender).toBe(client);
  expect(services.discordConnectionService).toBe(
    vi.mocked(DiscordConnectionService).mock.instances[0],
  );
  for (const repository of [
    DiscordAttemptRepository,
    DiscordConnectionRepository,
    DiscordDeliveryRepository,
  ]) {
    expect(vi.mocked(repository).mock.calls).toEqual([[CONTEXT.database]]);
  }
});

it("stores announced events and kicks the delivery for each enqueued one", () => {
  vi.mocked(readDiscordApplication).mockReturnValue(APPLICATION);

  createDiscordServices(CONTEXT);

  const [client] = vi.mocked(DiscordApiClient).mock.instances;
  const connections = vi.mocked(DiscordConnectionRepository).mock.instances[0];
  const deliveries = vi.mocked(DiscordDeliveryRepository).mock.instances[0];
  expect(vi.mocked(DiscordDeliveryWorker).mock.calls[0][0]).toEqual({
    attempts: vi.mocked(DiscordAttemptRepository).mock.instances[0],
    connections,
    deliveries,
    sender: client,
  });
  expect(vi.mocked(DiscordDeliveryScheduler).mock.calls).toEqual([
    [vi.mocked(DiscordDeliveryWorker).mock.instances[0]],
  ]);
  expect(vi.mocked(DiscordSubjectLookup).mock.calls).toEqual([
    [CONTEXT.taskRepository, CONTEXT.projectRepository],
  ]);
  const [notifications] = vi.mocked(DiscordNotificationService).mock.calls[0];
  expect(notifications).toMatchObject({
    connections,
    deliveries,
    subjects: vi.mocked(DiscordSubjectLookup).mock.instances[0],
  });
  expect(DiscordNotificationService.prototype.listen).toHaveBeenCalledWith(
    CONTEXT.events,
  );
  expect(DiscordDeliveryScheduler.prototype.kick).not.toHaveBeenCalled();
  notifications.onEnqueued?.();
  expect(DiscordDeliveryScheduler.prototype.kick).toHaveBeenCalledOnce();
  expect(
    vi.mocked(DiscordDeliveryScheduler.prototype.kick).mock.contexts[0],
  ).toBe(vi.mocked(DiscordDeliveryScheduler).mock.instances[0]);
});

it("starts the delivery scheduler once per process and stops it on shutdown", async () => {
  vi.mocked(readDiscordApplication).mockReturnValue(APPLICATION);

  createDiscordServices(CONTEXT);
  createDiscordServices(CONTEXT);

  expect(globalThis.pagesDiscordSchedulerStarted).toBe(true);
  expect(DiscordDeliveryScheduler.prototype.start).toHaveBeenCalledOnce();
  expect(DiscordNotificationService.prototype.listen).toHaveBeenCalledTimes(2);
  expect(registerShutdownTask).toHaveBeenCalledOnce();
  const [stop] = vi.mocked(registerShutdownTask).mock.calls[0];
  await stop();
  expect(DiscordDeliveryScheduler.prototype.stop).toHaveBeenCalledOnce();
  expect(
    vi.mocked(DiscordDeliveryScheduler.prototype.stop).mock.contexts[0],
  ).toBe(vi.mocked(DiscordDeliveryScheduler).mock.instances[0]);
});
