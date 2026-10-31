import { beforeEach, describe, expect, it, vi } from "vitest";

import { getApplicationServices } from "@/app/lib/services.server";
import { logDiagnostic } from "@/backend/logging/Logger";
import {
  obtainPicaMobileGateway,
  startPicaMobile,
} from "@/backend/runtime/PicaMobileRuntime";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { PagesPicaMobileAuthenticator } from "@/backend/service/mobile/PicaMobileAuthenticator";
import { PagesPicaMobileDashboard } from "@/backend/service/mobile/PicaMobileDashboardService";
import {
  PicaMobileGateway,
  PicaMobileListenError,
} from "@/backend/service/mobile/PicaMobileGateway";
import { PAGES_VERSION } from "@/definition/Version";

import { servicesOf } from "../../app/actions/action-fixtures";
import { createRuntime } from "./pages-server-fixture";

import type { PagesConfig } from "@/backend/config/PagesConfig";

vi.mock("@/app/lib/services.server", () => ({
  getApplicationServices: vi.fn(),
}));
vi.mock("@/backend/logging/Logger", () => ({
  logCaughtError: vi.fn(),
  logDiagnostic: vi.fn(),
  logEvent: vi.fn(),
}));
vi.mock("@/backend/runtime/ProcessLifecycle", () => ({
  registerShutdownTask: vi.fn(),
}));
vi.mock("@/backend/service/mobile/PicaMobileGateway", () => ({
  PicaMobileGateway: vi.fn(
    class {
      public readonly switchTo = vi.fn(async () => undefined);
      public readonly close = vi.fn(async () => undefined);
    },
  ),
  PicaMobileListenError: class extends Error {},
}));

const ANY_AUTHENTICATOR: unknown = expect.any(PagesPicaMobileAuthenticator);
const ANY_DASHBOARD: unknown = expect.any(PagesPicaMobileDashboard);

const COMPLETED: PagesConfig = {
  databasePath: "/srv/pages/data/pages.duckdb",
  firstRun: false,
  port: 3000,
};

beforeEach(() => {
  globalThis.pagesPicaMobileGateway = undefined;
});

describe("obtainPicaMobileGateway", () => {
  it("creates one gateway for the process and stops it with the server", async () => {
    const { runtime } = createRuntime({
      ...COMPLETED,
      listenAddress: "192.168.0.52",
    });

    const gateway = obtainPicaMobileGateway(runtime, 3000);

    expect(obtainPicaMobileGateway(runtime)).toBe(gateway);
    expect(PicaMobileGateway).toHaveBeenCalledTimes(1);
    expect(PicaMobileGateway).toHaveBeenCalledWith({
      authenticator: ANY_AUTHENTICATOR,
      dashboard: ANY_DASHBOARD,
      serverVersion: PAGES_VERSION,
      listenAddress: "192.168.0.52",
      reservedPort: 3000,
    });

    const [task] = vi.mocked(registerShutdownTask).mock.calls[0];

    await task();
    expect(gateway.close).toHaveBeenCalledTimes(1);
  });

  it("resolves the authentication service only when a connection needs it", async () => {
    const { runtime } = createRuntime(COMPLETED);
    const getAuthenticatedUser = vi.fn(async () => null);

    vi.mocked(getApplicationServices).mockResolvedValue(
      servicesOf({ authService: { getAuthenticatedUser } }),
    );
    obtainPicaMobileGateway(runtime);

    expect(getApplicationServices).not.toHaveBeenCalled();

    const { authenticator } = vi.mocked(PicaMobileGateway).mock.calls[0][0];

    expect(await authenticator.isSessionActive("token")).toBe(false);
    expect(getAuthenticatedUser).toHaveBeenCalledWith("token");
  });
});

describe("startPicaMobile", () => {
  it("creates the gateway but listens nowhere without a stored port", async () => {
    const { runtime } = createRuntime(COMPLETED);

    await startPicaMobile(runtime, 3000);

    const gateway = globalThis.pagesPicaMobileGateway;

    expect(gateway).toBeDefined();
    expect(gateway?.switchTo).not.toHaveBeenCalled();
  });

  it("listens on the stored port without storing it again", async () => {
    const { runtime, update } = createRuntime({
      ...COMPLETED,
      picaMobilePort: 3001,
    });

    await startPicaMobile(runtime, 3000);

    const switchTo = vi.mocked(globalThis.pagesPicaMobileGateway?.switchTo);
    const commit = switchTo?.mock.calls[0][1];

    expect(switchTo?.mock.calls[0][0]).toBe(3001);
    await expect(commit?.()).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });

  it("reports a port that cannot be bound and lets the server run on", async () => {
    const { runtime } = createRuntime({ ...COMPLETED, picaMobilePort: 3001 });

    await startPicaMobile(runtime, 3000);
    const failure = new PicaMobileListenError("portInUse");

    vi.mocked(globalThis.pagesPicaMobileGateway?.switchTo)?.mockRejectedValue(
      failure,
    );
    await expect(startPicaMobile(runtime, 3000)).resolves.toBeUndefined();

    expect(logDiagnostic).toHaveBeenCalledWith(
      "PicaMobileRuntime",
      "warn",
      expect.stringContaining("port 3001"),
      failure,
    );
  });
});
