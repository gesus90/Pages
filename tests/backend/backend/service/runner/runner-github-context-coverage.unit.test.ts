import { expect, it, vi } from "vitest";

import { encryptGitHubToken } from "@/backend/github/GitHubTokenCrypto";
import { RunnerGitHubContext } from "@/backend/service/runner/RunnerGitHubContext";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";

it("accepts only a well-formed GitHub repository from project settings", async () => {
  const findIntegration = vi
    .fn<ProjectRepository["findIntegration"]>()
    .mockResolvedValueOnce(
      partial({ repoUrl: "https://github.com/example/project.git" }),
    )
    .mockResolvedValueOnce(
      partial({ repoUrl: "https://other.example/example/project" }),
    )
    .mockResolvedValueOnce(null);
  const context = new RunnerGitHubContext(
    partial({ findIntegration }),
    Buffer.alloc(32),
  );
  await expect(context.repository("project")).resolves.toBe("example/project");
  await expect(context.repository("project")).rejects.toThrow(
    "repository required",
  );
  await expect(context.repository("project")).rejects.toThrow(
    "repository required",
  );
});

it("decrypts the configured token and rejects missing or malformed token values", async () => {
  const key = Buffer.alloc(32, 7);
  const findTokenEncrypted = vi
    .fn<ProjectRepository["findTokenEncrypted"]>()
    .mockResolvedValueOnce(encryptGitHubToken("test-token", key))
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(encryptGitHubToken("not valid", key));
  const context = new RunnerGitHubContext(partial({ findTokenEncrypted }), key);
  await expect(context.token("project")).resolves.toBe("test-token");
  await expect(context.token("project")).rejects.toThrow("token required");
  await expect(context.token("project")).rejects.toThrow(
    "Invalid project GitHub token",
  );
});
