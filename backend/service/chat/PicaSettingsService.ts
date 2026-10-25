import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { ChatError } from "@/backend/error/ChatErrors";
import { defaultAgentRunOptions } from "@/definition/AgentConfiguration";
import { isApiProvider } from "@/definition/AgentConnection";
import { isPicaModel, isPicaZenModel } from "@/definition/PicaModelSelection";

import {
  resolveAgentAssignment,
  resolveAgentAssignmentFor,
} from "../agents/AgentAssignmentResolution";
import { connectionModels } from "../agents/AgentConnectionModels";
import { requireAgentAdministrator } from "../agents/AgentServiceAccess";
import { isPicaAcpProvider, picaAcpRunner } from "./acp/PicaAcpRunners";
import { picaSelectionAdoption } from "./PicaSelectionAdoption";

import type { AgentProfile } from "@/definition/AgentProfile";

import type { PicaSettingsRepository } from "@/backend/database/repositories/chat/PicaSettingsRepository";
import type { ProfileDependencies } from "../agents/AgentProfileService";
import type { ResolvedAgentAssignment } from "../agents/AgentAssignmentResolution";
import type {
  PicaAdministration,
  PicaSettings,
} from "@/definition/PicaSettings";
import type { AgentModelSelection } from "@/definition/AgentModelSelection";
import type { PageAgentModel } from "@/definition/PageAgent";
import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";

interface PicaDependencies extends Pick<
  ProfileDependencies,
  "connections" | "profiles" | "authorization" | "groups"
> {
  readonly settings: PicaSettingsRepository;
}

/** One fixed Pica identity; selection uses the shared catalog, scopes and runner contracts. */
export class PicaSettingsService {
  private readonly dependencies: PicaDependencies;
  private readonly writes = new SerialQueue();
  private changing = false;
  private stop: (() => Promise<void>) | null = null;

  public constructor(dependencies: PicaDependencies) {
    this.dependencies = dependencies;
  }

  /** Connects the controlled chat cancellation path, never the plan engine. */
  public setStopHandler(stop: () => Promise<void>): void {
    this.stop = stop;
  }

  /** Reads activation without querying a provider; it never changes on temporary unavailability. */
  public async read(): Promise<PicaSettings> {
    const current = await this.dependencies.settings.read();
    if (current.legacyChecked) return current;
    return this.writes.run(async () => {
      const stored = await this.dependencies.settings.read();
      if (stored.legacyChecked) return stored;
      return this.adoptLegacy(stored);
    });
  }

  /** Rejects new sessions and turns while Pica is disabled or its configuration is changing. */
  public async requireEnabled(): Promise<void> {
    if (this.changing || !(await this.read()).isEnabled || this.changing)
      throw new ChatError("disabled");
  }

  /** Serializes short session/job admission with settings changes, never the model execution. */
  public async admit<Result>(work: () => Promise<Result>): Promise<Result> {
    await this.read();
    return this.writes.run(async () => {
      await this.requireEnabled();
      return work();
    });
  }

  /** Rechecks the acting person's connection scope on every turn; there is no fallback. */
  public async resolve(userId: string): Promise<ResolvedAgentAssignment> {
    await this.requireEnabled();
    const settings = await this.read();
    if (!settings.isEnabled || this.changing) throw new ChatError("disabled");
    if (!settings.selection) throw new AgentExecutionError("roleMissing");
    const assignment = await this.resolveSelection(
      await this.viewer(userId),
      settings.selection,
    );
    const resolved = settings.run
      ? { ...assignment, run: settings.run }
      : assignment;
    await this.requireRunner(resolved);
    return resolved;
  }

  /** Reauthorizes a pinned turn at the provider boundary after configuration changes. */
  public async requireCurrent(
    userId: string,
    expected: ResolvedAgentAssignment,
  ): Promise<void> {
    const current = await this.resolve(userId);
    if (
      current.connection.id !== expected.connection.id ||
      current.model !== expected.model ||
      current.reasoningEffort !== expected.reasoningEffort
    )
      throw new ChatError("contextChanged");
  }

  /** Supplies the protected form with the saved choice and its current usable models. */
  public async administration(userId: string): Promise<{
    readonly settings: PicaAdministration;
    readonly models: readonly PageAgentModel[];
  }> {
    const viewer = await this.viewer(userId);
    requireAgentAdministrator(viewer.actor);
    const settings = await this.read();
    const models = (
      await connectionModels(this.dependencies.connections, viewer)
    ).filter(isPicaModel);
    const adoption = await picaSelectionAdoption(
      this.dependencies.connections,
      settings.selection,
      models,
    );
    let error: PicaAdministration["error"] = null;
    try {
      if (!settings.selection)
        throw new AgentExecutionError(
          (await this.legacyCandidates()).length > 1
            ? "profileSelectionRequired"
            : "roleMissing",
        );
      const assignment = await this.resolveSelection(
        viewer,
        settings.selection,
      );
      await this.requireRunner(
        settings.run ? { ...assignment, run: settings.run } : assignment,
      );
    } catch (caughtError: unknown) {
      if (!(caughtError instanceof AgentExecutionError)) throw caughtError;
      error = caughtError.code;
    }
    return {
      settings: { ...settings, error, ...(adoption ? { adoption } : {}) },
      models,
    };
  }

  /** Saves activation and routing together; switching identity stops the old work before returning. */
  public async save(
    userId: string,
    input: {
      readonly isEnabled: boolean;
      readonly selection: AgentModelSelection | null;
      readonly revision: number;
    },
  ): Promise<void> {
    const viewer = await this.viewer(userId);
    requireAgentAdministrator(viewer.actor);
    await this.read();
    await this.writes.run(async () => {
      const previous = await this.dependencies.settings.read();
      if (previous.revision !== input.revision)
        throw new AgentError("profile_conflict");
      const selection = input.isEnabled ? input.selection : previous.selection;
      const hasChanged =
        JSON.stringify(previous.selection) !== JSON.stringify(selection);
      let run = previous.run;
      if (input.isEnabled) {
        if (!selection) throw new AgentExecutionError("roleMissing");
        const assignment = await this.resolveSelection(viewer, selection);
        if (
          hasChanged &&
          previous.selection?.connectionId !== selection.connectionId
        )
          run = defaultAgentRunOptions(assignment.connection.provider);
        await this.requireRunner(run ? { ...assignment, run } : assignment);
      }
      this.changing = true;
      try {
        await this.dependencies.settings.save({
          isEnabled: input.isEnabled,
          selection,
          run,
          revision: input.revision,
        });
        if (!input.isEnabled || hasChanged) await this.stop?.();
      } finally {
        this.changing = false;
      }
    });
  }

  private async resolveSelection(
    viewer: AgentViewer,
    selection: AgentModelSelection,
  ): Promise<ResolvedAgentAssignment> {
    try {
      return await resolveAgentAssignmentFor(
        this.dependencies.connections,
        viewer,
        selection,
      );
    } catch (error: unknown) {
      if (
        !(error instanceof AgentExecutionError) ||
        error.code === "accessDenied"
      )
        throw error;
      const connection = await this.dependencies.connections.find(
        selection.connectionId,
      );
      if (connection && isApiProvider(connection.provider))
        throw new AgentExecutionError("picaModelSelectionRequired");
      throw error;
    }
  }

  private async viewer(userId: string): Promise<AgentViewer> {
    const [snapshot, groupIds] = await Promise.all([
      this.dependencies.authorization.snapshot(),
      this.dependencies.groups.findIdsByMember(userId),
    ]);
    const actor = snapshot.accounts.find(
      (account) => account.userId === userId,
    );
    if (!actor?.isActive) throw new AgentExecutionError("accessDenied");
    return { actor, groupIds };
  }

  private async adoptLegacy(stored: PicaSettings): Promise<PicaSettings> {
    const candidates = await this.legacyCandidates();
    const source = candidates.length === 1 ? candidates[0] : undefined;
    const selection = source
      ? {
          connectionId: source.connectionId,
          model: source.model,
          reasoningEffort: source.reasoningEffort,
        }
      : null;
    let isEnabled = false;
    if (source?.isActive && selection) {
      try {
        const assignment = await resolveAgentAssignment(
          this.dependencies.connections,
          selection,
        );
        await this.requireRunner(
          source.configuration?.run
            ? { ...assignment, run: source.configuration.run }
            : assignment,
        );
        isEnabled = true;
      } catch (error: unknown) {
        if (!(error instanceof AgentExecutionError)) throw error;
      }
    }
    await this.dependencies.settings.save({
      ...stored,
      isEnabled,
      selection,
      run: source?.configuration?.run ?? null,
    });
    return this.dependencies.settings.read();
  }

  private async legacyCandidates(): Promise<readonly AgentProfile[]> {
    return (await this.dependencies.profiles.list()).filter(
      (profile) =>
        !profile.ownerId &&
        !profile.configuration?.projectId &&
        profile.purposes.includes("chat") &&
        profile.targets.some(
          (target) => target.kind === "system" && target.targetId === "chat",
        ),
    );
  }

  private async requireRunner(
    assignment: ResolvedAgentAssignment,
  ): Promise<void> {
    if (!isPicaAcpProvider(assignment.connection.provider))
      throw new AgentExecutionError("picaModelSelectionRequired");
    const catalog = await this.dependencies.connections
      .catalogs()
      .find(assignment.connection.id);
    const model = catalog.models.find((entry) => entry.id === assignment.model);
    if (
      isPicaZenModel({
        provider: assignment.connection.provider,
        model: assignment.model,
        isFree: model?.isFree,
      })
    )
      throw new AgentExecutionError("picaZenUnsupported");
    try {
      picaAcpRunner(assignment).runOptions(assignment);
    } catch (error: unknown) {
      if (!(error instanceof ChatError)) throw error;
      throw new AgentExecutionError("connectionUnavailable");
    }
  }
}
