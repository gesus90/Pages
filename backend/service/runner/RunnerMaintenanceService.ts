import { runnerAddress } from "@/scripts/runner/address.mjs";
import {
  RUNNER_RELEASE,
  runnerMaintenanceSchema,
  runnerSettingsSchema,
} from "@/definition/RunnerMaintenance";

import { runnerUpdatePackage } from "./RunnerArtifact";
import { LOCAL_RUNNER_CONNECTION_ID } from "./LocalRunnerIdentity";
import { pairingEndpoint } from "../remote/setup/SetupPairing";

import type { RunnerMaintenanceRepository } from "@/backend/database/repositories/runner/RunnerMaintenanceRepository";
import type { RunnerRepository } from "@/backend/database/repositories/runner/RunnerRepository";
import type { RunnerService } from "./RunnerService";
import type {
  RunnerSettings,
  RunnerUpdatePackage,
  RunnerMaintenanceReply,
  RunnerMaintenanceState,
  RunnerMaintenanceReceipt,
} from "@/definition/RunnerMaintenance";

/** Coordinates persisted settings and release offers over the existing authenticated channel. */
export class RunnerMaintenanceService {
  private readonly repository: RunnerMaintenanceRepository;
  private readonly runners: RunnerService;
  private readonly identities: RunnerRepository;
  private readonly publicAddress: () => Promise<string | undefined>;
  private readonly artifact: RunnerUpdatePackage;

  public constructor(input: {
    repository: RunnerMaintenanceRepository;
    runners: RunnerService;
    identities: RunnerRepository;
    artifact?: RunnerUpdatePackage;
    publicAddress?: () => Promise<string | undefined>;
  }) {
    this.repository = input.repository;
    this.runners = input.runners;
    this.identities = input.identities;
    this.publicAddress =
      input.publicAddress ??
      (async () => {
        const { getPagesRuntime } =
          await import("@/backend/runtime/PagesRuntime");
        return (await getPagesRuntime()).getConfig().publicUrl;
      });
    this.artifact = input.artifact ?? runnerUpdatePackage();
  }

  /** Resolves a public origin, with secure transport even for an HTTP browser origin. */
  public async settings(origin?: string | null): Promise<RunnerSettings> {
    const settings = await this.repository.settings();
    const source =
      settings.address ??
      process.env.PAGES_RUNNER_PUBLIC_URL ??
      (await this.publicAddress()) ??
      origin;
    return {
      ...settings,
      address: source ? runnerAddress(source, settings.allowInsecureLan) : null,
    };
  }

  /** Called only after the settings route checked active administrator rights. */
  public async save(input: unknown): Promise<void> {
    const settings = runnerSettingsSchema.parse(input);
    const address = settings.address
      ? runnerAddress(settings.address, settings.allowInsecureLan)
      : null;
    await this.repository.save({ ...settings, address });
  }

  /** Returns a pairing endpoint and LAN choice without disclosing a machine credential. */
  public async pairing(
    connectionId: string,
    origin: string | null,
    sshHost?: string,
  ): Promise<{ endpoint: string; allowInsecureLan: boolean }> {
    const settings = await this.settings(origin);
    if (!settings.address) throw new Error("Runner Pages address required");
    const endpoint = pairingEndpoint({
      origin: settings.address,
      publicUrl: null,
      connectionId,
      sshHost: sshHost ?? "",
      allowInsecureLan: settings.allowInsecureLan,
    });
    return { endpoint, allowInsecureLan: settings.allowInsecureLan };
  }

  /** Persists explicit retry intent for an administrator-visible registered runner. */
  public async request(userId: string, connectionId: string): Promise<void> {
    const row = (await this.runners.overview(userId)).find(
      (entry) => entry.connectionId === connectionId,
    );
    if (!row?.runnerId) throw new Error("Registered runner required");
    await this.repository.request(connectionId);
  }

  /** Adds durable status receipts to the administrator's existing permitted overview. */
  public async overview(
    userId: string,
  ): Promise<Readonly<Record<string, RunnerMaintenanceState>>> {
    const rows = await this.runners.overview(userId);
    const entries = await Promise.all(
      rows.map(async (row) => {
        const state = await this.repository.state(row.connectionId);
        const record = await this.identities.find(row.connectionId);
        const receipt =
          state.receipt?.sessionId === record?.state.sessionId
            ? state.receipt
            : null;
        return [row.connectionId, { ...state, receipt }] as const;
      }),
    );
    return Object.fromEntries(entries);
  }

  /** Validates session and actual reconciled version before recording success or offering any package. */
  public async receive(
    connectionId: string,
    input: unknown,
  ): Promise<RunnerMaintenanceReply> {
    const receipt = runnerMaintenanceSchema.parse(input);
    const record = await this.identities.find(connectionId);
    if (!(await this.runners.status(connectionId)).isPaired)
      throw new Error("Runner identity no longer authorized");
    if (
      !record ||
      receipt.sessionId !== record.state.sessionId ||
      receipt.runnerVersion !== record.state.runnerVersion
    )
      throw new Error("Runner maintenance identity mismatch");
    const state = await this.repository.state(connectionId);
    const isVerified = receipt.runnerVersion === RUNNER_RELEASE;
    await this.repository.record(
      connectionId,
      receipt,
      isVerified ||
        receipt.status === "failed" ||
        receipt.status === "rolled-back",
    );
    const settings = await this.settings();
    const shouldUpdate =
      !isVerified && this.shouldOffer(receipt, state, settings);
    return {
      version: 1,
      type: "maintenance",
      sessionId: receipt.sessionId,
      endpoint:
        connectionId !== LOCAL_RUNNER_CONNECTION_ID && settings.address
          ? `${settings.address}/runner/v1/channel/${connectionId}`
          : null,
      allowInsecureLan: settings.allowInsecureLan,
      update: shouldUpdate ? this.artifact : undefined,
    };
  }

  private shouldOffer(
    receipt: RunnerMaintenanceReceipt,
    previous: RunnerMaintenanceState,
    settings: RunnerSettings,
  ): boolean {
    const hasFailed =
      ["failed", "rolled-back"].includes(receipt.status) &&
      receipt.targetVersion === RUNNER_RELEASE;
    const isNewFailure =
      hasFailed && previous.receipt?.status !== receipt.status;
    return (
      (previous.requested && !isNewFailure) ||
      (settings.automaticUpdates && !hasFailed)
    );
  }
}
