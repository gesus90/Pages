import { isInAgentConnectionScope } from "@/backend/auth/AgentConnectionScopePolicy";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  isOpenCodeLinkedProvider,
  linkedApiProviderOf,
  OPENCODE_LINKED_PROVIDERS,
  openCodeModelProvider,
} from "@/definition/AgentConnection";

import type { AgentViewer } from "@/backend/auth/AgentProfilePolicy";
import type {
  OpenCodeKeyInput,
  OpenCodeLinkedKeys,
} from "@/backend/agents/cli/OpenCodeCredentials";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { AccountAccess } from "@/definition/Authorization";
import type {
  OpenCodeLinkedProvider,
  OpenCodeProviderLink,
} from "@/definition/AgentConnection";

/** The API connection whose key OpenCode receives for one provider, and why. */
interface LinkCandidate {
  readonly connection: AgentConnectionRecord;
  readonly isVerified: boolean;
  readonly hasFailed: boolean;
}

/**
 * Finds, per linked API provider, the API connection whose key OpenCode uses.
 *
 * @param connections - Connection persistence.
 * @returns For each provider with an active key: the first connection by name
 * whose access check passed, otherwise the first one with its check state.
 *
 * @remarks
 * Only a passed access check links a key, as for a direct API run, so an
 * invalid or unchecked key never reaches OpenCode.
 */
export async function findOpenCodeLinks(
  connections: AgentConnectionRepository,
): Promise<ReadonlyMap<OpenCodeLinkedProvider, LinkCandidate>> {
  const links = new Map<OpenCodeLinkedProvider, LinkCandidate>();
  for (const connection of await connections.list()) {
    const { provider } = connection;
    if (
      !isOpenCodeLinkedProvider(provider) ||
      !connection.isActive ||
      !connection.hasApiKey ||
      links.get(provider)?.isVerified === true
    )
      continue;
    const auth = await connections.checks().find(connection.id, "auth");
    const candidate = {
      connection,
      isVerified: auth?.status === "passed",
      hasFailed: auth?.status === "failed",
    };
    if (candidate.isVerified || !links.has(provider))
      links.set(provider, candidate);
  }
  return links;
}

/**
 * Whether a person may use an OpenCode model through the key of its provider.
 *
 * @param connections - Connection persistence.
 * @param viewer - The person who chooses or runs the model.
 * @param request - The OpenCode connection and the model's full ID.
 * @returns `true` for a free model, a model of the connection's own key, and
 * a model whose linked API connection admits the person.
 */
export async function canUseOpenCodeModel(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
  request: {
    readonly connection: AgentConnectionRecord;
    readonly model: string;
    readonly links?: ReadonlyMap<OpenCodeLinkedProvider, LinkCandidate>;
  },
): Promise<boolean> {
  const { connection, model } = request;
  const modelProvider = openCodeModelProvider(model);
  const provider = linkedApiProviderOf(modelProvider);
  if (
    connection.provider !== "opencode" ||
    provider === null ||
    connection.cliAccountLabel === modelProvider
  )
    return true;
  const links = request.links ?? (await findOpenCodeLinks(connections));
  const link = links.get(provider);
  if (!link?.isVerified) return false;
  const scope = await connections.scopes().find(link.connection.id);
  return scope !== null && isInAgentConnectionScope(scope, viewer);
}

/**
 * Refuses an OpenCode model whose linked key the person may not use.
 *
 * @throws {AgentExecutionError} `accessDenied` when the linked API connection
 * excludes the person or no longer supplies a verified key.
 */
export async function requireOpenCodeModelAccess(
  connections: AgentConnectionRepository,
  viewer: AgentViewer,
  request: {
    readonly connection: AgentConnectionRecord;
    readonly model: string;
  },
): Promise<void> {
  if (!(await canUseOpenCodeModel(connections, viewer, request)))
    throw new AgentExecutionError("accessDenied");
}

/** Supplies the verified keys of the linked API connections to OpenCode processes. */
export class OpenCodeProviderKeys implements OpenCodeLinkedKeys {
  private readonly connections: AgentConnectionRepository;
  private readonly cipher: InstanceSecretCipher;

  public constructor(
    connections: AgentConnectionRepository,
    cipher: InstanceSecretCipher,
  ) {
    this.connections = connections;
    this.cipher = cipher;
  }

  /** Decrypts each linked key for the moment of one process start; an unreadable key is left out. */
  public async read(): Promise<readonly OpenCodeKeyInput[]> {
    const keys: OpenCodeKeyInput[] = [];
    for (const [provider, link] of await findOpenCodeLinks(this.connections)) {
      if (!link.isVerified) continue;
      try {
        const encrypted = await this.connections.findSecretEncrypted(
          link.connection.id,
        );
        if (encrypted === null) continue;
        keys.push({
          modelProvider: OPENCODE_LINKED_PROVIDERS[provider],
          apiKey: this.cipher.decrypt(link.connection.id, encrypted),
        });
      } catch (error: unknown) {
        logCaughtError("OpenCodeProviderKeys", error);
      }
    }
    return keys;
  }
}

interface LinkDependencies {
  readonly connections: AgentConnectionRepository;
  readonly check: (actor: AccountAccess, id: string) => Promise<unknown>;
  readonly refreshCatalog: (id: string) => Promise<unknown>;
}

/**
 * Keeps OpenCode's providers in step with the API keys stored in Pages.
 *
 * @remarks
 * Storing, replacing, enabling, disabling or deleting a linked key checks it
 * and refreshes every signed-in OpenCode catalog, so the provider's models
 * appear or disappear without any further step.
 */
export class OpenCodeProviderLinks {
  private readonly dependencies: LinkDependencies;

  public constructor(dependencies: LinkDependencies) {
    this.dependencies = dependencies;
  }

  /** The state of every linked provider, without any key material. */
  public async describe(): Promise<readonly OpenCodeProviderLink[]> {
    const links = await findOpenCodeLinks(this.dependencies.connections);
    return Object.keys(OPENCODE_LINKED_PROVIDERS)
      .filter((provider) => isOpenCodeLinkedProviderKey(provider))
      .map((provider) => describeLink(provider, links.get(provider)));
  }

  /**
   * Checks a changed key of a linked provider and refreshes OpenCode.
   *
   * @param actor - The administrator who changed the connection.
   * @param id - The API connection that was created, changed or enabled.
   */
  public async afterKeyChange(actor: AccountAccess, id: string): Promise<void> {
    const connection = await this.dependencies.connections.find(id);
    if (connection && !isOpenCodeLinkedProvider(connection.provider)) return;
    if (connection?.isActive && connection.hasApiKey)
      await this.dependencies.check(actor, id).catch((error: unknown) => {
        logCaughtError("OpenCodeProviderLinks", error);
      });
    await this.refresh();
  }

  /**
   * Signs a new or emptied OpenCode connection in with its free models.
   *
   * @param actor - The administrator who created or changed the connection.
   * @param id - Any connection; only an OpenCode connection is checked.
   *
   * @remarks
   * The access check reads the reachable providers without a model call and
   * loads the catalog, so the connection needs no key of its own.
   */
  public async activate(actor: AccountAccess, id: string): Promise<void> {
    const connection = await this.dependencies.connections.find(id);
    if (connection?.provider !== "opencode" || !connection.isActive) return;
    await this.dependencies.check(actor, id).catch((error: unknown) => {
      logCaughtError("OpenCodeProviderLinks", error);
    });
  }

  /** Whether a connection supplies, or could supply, a key OpenCode receives. */
  public async isLinkCandidate(id: string): Promise<boolean> {
    const connection = await this.dependencies.connections.find(id);
    return connection !== null && isOpenCodeLinkedProvider(connection.provider);
  }

  /** Reloads the catalog of every signed-in, active OpenCode connection. */
  public async refresh(): Promise<void> {
    for (const connection of await this.dependencies.connections.list()) {
      if (
        connection.provider !== "opencode" ||
        !connection.isActive ||
        connection.cliLoggedInAt === null
      )
        continue;
      await this.dependencies
        .refreshCatalog(connection.id)
        .catch((error: unknown) => {
          logCaughtError("OpenCodeProviderLinks", error);
        });
    }
  }
}

function isOpenCodeLinkedProviderKey(
  provider: string,
): provider is OpenCodeLinkedProvider {
  return Object.hasOwn(OPENCODE_LINKED_PROVIDERS, provider);
}

function describeLink(
  provider: OpenCodeLinkedProvider,
  link: LinkCandidate | undefined,
): OpenCodeProviderLink {
  const modelProvider = OPENCODE_LINKED_PROVIDERS[provider];
  if (!link)
    return {
      provider,
      modelProvider,
      state: "missing",
      connectionId: null,
      connectionName: null,
    };
  let state: OpenCodeProviderLink["state"] = "unchecked";
  if (link.isVerified) state = "linked";
  else if (link.hasFailed) state = "auth_failed";
  return {
    provider,
    modelProvider,
    state,
    connectionId: link.connection.id,
    connectionName: link.connection.name,
  };
}
