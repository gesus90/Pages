import path from "node:path";
import { createWikiHarness } from "./wiki-harness";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { McpOAuthRepository } from "@/backend/database/repositories/mcp/McpOAuthRepository";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";
import { OAuthTokenService } from "@/backend/service/mcp/OAuthTokenService";
import { AgentUploadAuthorityService } from "@/backend/service/agents/AgentUploadAuthorityService";
import { AgentUploadTicketService } from "@/backend/service/agents/AgentUploadTicketService";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { AgentWikiCreateService } from "@/backend/service/agents/AgentWikiCreateService";
import { AgentWriteOperationService } from "@/backend/service/agents/AgentWriteOperationService";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { testOAuthConfiguration } from "./mcp-authorization";

import type { Database } from "@/backend/database/Database";
import type { AgentIdentity } from "@/definition/McpAuthorization";
import type { AgentWikiCreateInput } from "@/definition/PagesAgentWrites";

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYZkAAAAASUVORK5CYII=",
  "base64",
);

function pdfFixture(): Buffer<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(content);
  content += "xref\n0 5\n0000000000 65535 f \n";
  for (const offset of offsets.slice(1))
    content += `${String(offset).padStart(10, "0")} 00000 n \n`;
  content += `trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
export const PDF = pdfFixture();
export const WRITE_IDENTITY: AgentIdentity = {
  userId: "owner",
  isAdmin: true,
  permissions: ["write"],
};

export async function* bytes(...parts: Uint8Array[]) {
  for (const part of parts) yield part;
}

export function createInput(
  overrides: Partial<AgentWikiCreateInput> = {},
): AgentWikiCreateInput {
  return {
    operationId: "operation-1",
    projectId: "p1",
    parentId: null,
    title: "Created",
    content: "# Created",
    icon: null,
    assetIds: [],
    ...overrides,
  };
}

export async function agentWriteFixture(database: Database) {
  const harness = createWikiHarness(database);
  const owner = await harness.addUser("owner", { isAdmin: true, mode: "role" });
  const reader = await harness.addUser("reader", { capabilities: [] });
  const other = await harness.addUser("other", { isAdmin: true });
  await harness.addProject("p1");
  await harness.addProject("p2");
  const userRepository = new UserRepository(database);
  const users = { getById: (id: string) => userRepository.findById(id) };
  const administration = {
    getContext: async (id: string) => {
      const account = (
        await new AuthorizationRepository(database).snapshot()
      ).accounts.find((entry) => entry.userId === id);
      if (!account) throw new Error("Missing fixture account.");
      return account;
    },
  };
  const identities = new AgentIdentityService(users, administration);
  const personal = new PersonalAgentTokenService(
    new PersonalAgentTokenRepository(database),
    identities,
  );
  const oauth = new OAuthTokenService(
    new McpOAuthRepository(database),
    identities,
    () => testOAuthConfiguration,
  );
  const authority = new AgentUploadAuthorityService(personal, oauth);
  const tickets = new AgentUploadTicketService((hash, issuedAt) =>
    authority.verify(hash, issuedAt),
  );
  const staging = new WikiFileStore(
    path.join(harness.filesDirectory, "staging"),
  );
  const wikiFiles = new WikiFileStore(harness.filesDirectory);
  const repository = new AgentAssetRepository(database);
  const assets = new AgentAssetService({
    repository,
    files: staging,
    wiki: harness.service,
  });
  const events = new PagesEventPublisher();
  const create = new AgentWikiCreateService({
    database,
    staging,
    wikiFiles,
    events,
  });
  const writes = new AgentWriteOperationService({
    users,
    tickets,
    assets,
    create,
    wiki: harness.service,
  });
  const router = new AgentOperationRouter({
    projects: new ProjectRepository(database),
    wiki: harness.repository,
    users,
    writes,
  });
  const api = new PagesAgentApiService(
    personal,
    oauth,
    new AgentProjectService(new ProjectRepository(database)),
    router,
  );
  const credential = await personal.create(owner.id, "test", null);
  return {
    ...harness,
    owner,
    reader,
    other,
    personal,
    oauth,
    identities,
    authority,
    tickets,
    staging,
    wikiFiles,
    assets,
    events,
    create,
    writes,
    router,
    api,
    token: credential.token,
    tokenId: credential.summary.id,
    assetRepository: repository,
    operationRepository: new AgentOperationKeyRepository(database),
  };
}
