import { z } from "zod";

const commit = z.string().regex(/^[a-fA-F0-9]{7,40}$/u);
const page = z.number().int().min(1).max(10000).default(1);
const limit = z.number().int().min(1).max(100).default(30);
const projectId = z.string().min(1).max(200);

/** Read-only repository tool contracts; no URL, token, shell or checkout parameter. */
export const REPOSITORY_READ_SCHEMAS = {
  repository_log: z
    .object({
      projectId,
      range: z
        .string()
        .regex(/^[a-fA-F0-9]{7,40}\.\.[a-fA-F0-9]{7,40}$/u)
        .optional(),
      commit: commit.optional(),
      page,
      limit,
    })
    .strict(),
  repository_diff: z.object({ projectId, base: commit, head: commit }).strict(),
  repository_show: z.object({ projectId, commit, page, limit }).strict(),
  repository_file: z
    .object({
      projectId,
      commit,
      path: z
        .string()
        .min(1)
        .max(4096)
        .refine(
          (path) =>
            !path.startsWith("/") &&
            !/[\\\u0000-\u001f]/u.test(path) &&
            path
              .split("/")
              .every((part) => part !== ".." && part !== "." && part !== ""),
        ),
    })
    .strict(),
} as const;

/** A Pages-owned repository read; all authorization is server-side. */
export type RepositoryReadTool = keyof typeof REPOSITORY_READ_SCHEMAS;

/** Stable public error; never contains a credential or a transport diagnosis. */
export class RepositoryReadError extends Error {
  public readonly code:
    | "FORBIDDEN"
    | "INVALID_REQUEST"
    | "NOT_CONNECTED"
    | "PROVIDER_UNAVAILABLE"
    | "TOO_LARGE";

  public constructor(code: RepositoryReadError["code"]) {
    super(code);
    this.code = code;
  }
}
