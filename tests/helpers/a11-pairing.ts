import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { PairingService } from "@/backend/service/mcp/PairingService";
import { wireFixture } from "./mcp-authorization";
import { createUser } from "./factories";

export const pairingAddress = { socket: "127.0.0.1", forwarded: null };
export const pairingClient = {
  clientName: "Pages MCP",
  device: "laptop",
  packageVersion: "0.1.0",
};

/** Real migrated DuckDB in a temporary directory, with no production runtime or listener. */
export async function pairingFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "pages-a11-pairing-"));
  const database = await Database.create(path.join(directory, "test.duckdb"));
  await database.migrate(DATABASE_MIGRATIONS);
  const fixture = wireFixture(database);
  const userRepository = new UserRepository(database);
  await userRepository.insert({ ...createUser(), passwordHash: "test-only" });
  const pairing = new PairingService(
    new PairingRepository(database),
    fixture.identities,
  );
  return {
    ...fixture,
    pairing,
    userRepository,
    directory,
    close: async () => {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
