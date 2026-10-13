import {
  readBooleanColumn,
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { AgentError, AgentInUseError } from "@/backend/error/AgentErrors";
import {
  configurationForTargets,
  readAgentConfiguration,
} from "@/backend/agents/AgentConfigurationInput";
import {
  isAgentProfilePurpose,
  isAgentProfileTargetKind,
} from "@/definition/AgentProfile";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentProfile,
  AgentProfileTarget,
} from "@/definition/AgentProfile";
import type { AgentReference, AgentUsage } from "@/definition/AgentUsage";

/** Statement operations shared by profile writes and the legacy system function facade. */
export class AgentProfileStore {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Reads only explicit configuration columns, never credentials. */
  public async list(): Promise<readonly AgentProfile[]> {
    const rows = await this.database.query(`
      SELECT
          id,
          name,
          connection_id,
          model,
          reasoning_effort,
          is_active,
          configuration_json,
          revision,
          owner_id,
          model_profile_id
      FROM agent_execution_profiles
      ORDER BY lower(name), id;
    `);
    const purposes = await this.database.query(`
      SELECT
          profile_id,
          purpose
      FROM agent_profile_purposes
      ORDER BY purpose;
    `);
    const targets = await this.database.query(`
      SELECT
          profile_id,
          kind,
          target_id
      FROM agent_profile_targets
      ORDER BY kind, target_id;
    `);
    return rows.map((row) => {
      const id = readTextColumn(row, 0, "id");
      return {
        id,
        name: readTextColumn(row, 1, "name"),
        connectionId: readTextColumn(row, 2, "connection_id"),
        model: readTextColumn(row, 3, "model"),
        reasoningEffort: readNullableTextColumn(row, 4, "reasoning_effort"),
        isActive: readBooleanColumn(row, 5, "is_active"),
        configuration: readAgentConfiguration(
          JSON.parse(readTextColumn(row, 6, "configuration_json")),
        ),
        revision: readCountColumn(row, 7, "revision"),
        ...(readNullableTextColumn(row, 8, "owner_id") === null
          ? {}
          : {
              ownerId: readTextColumn(row, 8, "owner_id"),
              modelProfileId: readTextColumn(row, 9, "model_profile_id"),
            }),
        purposes: purposes
          .filter((entry) => entry[0] === id)
          .map((entry) => {
            const purpose = readTextColumn(entry, 1, "purpose");
            if (!isAgentProfilePurpose(purpose))
              throw new AgentError("profile_invalid");
            return purpose;
          }),
        targets: targets
          .filter((entry) => entry[0] === id)
          .map((entry) => {
            const kind = readTextColumn(entry, 1, "kind");
            if (!isAgentProfileTargetKind(kind))
              throw new AgentError("profile_invalid");
            return { kind, targetId: readTextColumn(entry, 2, "target_id") };
          }),
      };
    });
  }

  /** Replaces one profile and its scopes inside the caller's transaction. */
  public async save(profile: AgentProfile): Promise<void> {
    if (profile.revision !== undefined) {
      const [row] = await this.database.query(
        `
        SELECT revision
        FROM agent_execution_profiles
        WHERE id = $id;
      `,
        { id: profile.id },
      );
      if (!row || readCountColumn(row, 0, "revision") !== profile.revision)
        throw new AgentError("profile_conflict");
    }
    await this.requireAvailableFunctions(profile);
    await this.saveRecord(profile);
    await this.replaceScopes(profile);
  }

  /** Deletes only an unused profile, without withdrawing references or changing connections. */
  public async remove(id: string): Promise<void> {
    const usages = await this.usages(id);
    if (usages.length > 0) throw new AgentInUseError("profile_in_use", usages);
    await this.clearScopes(id);
    await this.database.execute(
      "DELETE FROM agent_execution_profiles WHERE id = $id;",
      { id },
    );
  }

  /** Checks every current reference inside the same transaction as deletion. */
  public async usages(id: string): Promise<readonly AgentUsage[]> {
    const profile = (await this.list()).find((entry) => entry.id === id);
    if (!profile) return [];
    const rows = await this.database.query(
      `
      SELECT function
      FROM agent_legacy_function_assignments
      WHERE profile_id = $id;
    `,
      { id },
    );
    const configuration = profile.configuration;
    const usages: AgentUsage[] = profile.targets.map((target) => ({
      kind: "assignment",
      target,
    }));
    for (const target of configuration?.sharing.targets ?? [])
      usages.push({ kind: "sharing", target });
    if (configuration?.sharing.isGlobal) usages.push({ kind: "global" });
    if (configuration?.projectId)
      usages.push({ kind: "project", id: configuration.projectId });
    for (const row of rows)
      usages.push({ kind: "legacy", id: readTextColumn(row, 0, "function") });
    const plans = await this.database.query(
      `
      SELECT DISTINCT plans.id
      FROM agent_plans AS plans,
          json_each(json_extract(plans.plan_json, '$.nodes')) AS node
      WHERE json_extract_string(node.value, '$.type') = 'agent'
          AND (
              json_extract_string(node.value, '$.agentId') = $id
              OR json_extract_string(node.value, '$.personalAgentId') = $id
          );
    `,
      { id },
    );
    for (const row of plans)
      usages.push({ kind: "plan", id: readTextColumn(row, 0, "id") });
    return usages;
  }

  /**
   * Names every administrator agent whose scope or usage sharing still references a group, department or person.
   *
   * @remarks
   * Agents of users do not count: an administrator cannot change them, so they
   * would block the deletion without a way to resolve it. A deleted group
   * simply never matches anyone there.
   */
  public async references(
    target: AgentProfileTarget,
  ): Promise<readonly AgentReference[]> {
    return (await this.list())
      .filter(
        (profile) =>
          profile.ownerId === undefined &&
          [
            ...profile.targets,
            ...(profile.configuration?.sharing.targets ?? []),
          ].some(
            (entry) =>
              entry.kind === target.kind && entry.targetId === target.targetId,
          ),
      )
      .map((profile) => ({ id: profile.id, name: profile.name }));
  }

  private async saveRecord(profile: AgentProfile): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_execution_profiles (
          id,
          name,
          connection_id,
          model,
          reasoning_effort,
          is_active,
          configuration_json,
          revision,
          owner_id,
          model_profile_id
      ) VALUES (
          $id,
          $name,
          $connection_id,
          $model,
          $reasoning_effort,
          $is_active,
          $configuration_json,
          1,
          $owner_id,
          $model_profile_id
      )
      ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          connection_id = EXCLUDED.connection_id,
          model = EXCLUDED.model,
          reasoning_effort = EXCLUDED.reasoning_effort,
          is_active = EXCLUDED.is_active,
          configuration_json = EXCLUDED.configuration_json,
          owner_id = EXCLUDED.owner_id,
          model_profile_id = EXCLUDED.model_profile_id,
          revision = agent_execution_profiles.revision + 1;
    `,
      {
        id: profile.id,
        name: profile.name,
        connection_id: profile.connectionId,
        model: profile.model,
        reasoning_effort: profile.reasoningEffort,
        is_active: profile.isActive,
        owner_id: profile.ownerId ?? null,
        model_profile_id: profile.modelProfileId ?? null,
        configuration_json: JSON.stringify(
          profile.configuration ?? configurationForTargets(profile.targets),
        ),
      },
    );
  }

  private async replaceScopes(profile: AgentProfile): Promise<void> {
    await this.clearScopes(profile.id);
    for (const purpose of profile.purposes)
      await this.database.execute(
        `
        INSERT INTO agent_profile_purposes (
            profile_id,
            purpose
        ) VALUES (
            $id,
            $purpose
        );
      `,
        { id: profile.id, purpose },
      );
    for (const target of profile.targets)
      await this.database.execute(
        `
        INSERT INTO agent_profile_targets (
            profile_id,
            kind,
            target_id
        ) VALUES (
            $id,
            $kind,
            $target_id
        );
      `,
        { id: profile.id, kind: target.kind, target_id: target.targetId },
      );
  }

  private async requireAvailableFunctions(
    profile: AgentProfile,
  ): Promise<void> {
    const functions = profile.targets.filter(
      (target) => target.kind === "system" && target.targetId !== "agent",
    );
    for (const target of functions) {
      const rows = await this.database.query(
        `
        SELECT profile_id
        FROM agent_profile_targets
        WHERE kind = 'system'
            AND target_id = $function
            AND profile_id <> $id;
      `,
        { function: target.targetId, id: profile.id },
      );
      if (rows.length > 0) throw new AgentError("system_function_in_use");
    }
  }

  private async clearScopes(id: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM agent_profile_targets WHERE profile_id = $id;",
      { id },
    );
    await this.database.execute(
      "DELETE FROM agent_profile_purposes WHERE profile_id = $id;",
      { id },
    );
  }
}
