import { PLAN_SWARM_MEMORY_REDACTED } from "@/definition/AgentPlanSwarmMemory";

/** A pattern of a secret and how its match is replaced. */
interface SecretPattern {
  readonly pattern: RegExp;
  /** Keeps the name before the secret, such as `password=` or `Bearer `. */
  readonly replace: (match: string, ...groups: string[]) => string;
}

const MARK = PLAN_SWARM_MEMORY_REDACTED;

const whole = (): string => MARK;

const keepName = (_: string, name: string): string => `${name}${MARK}`;

/**
 * Secrets in the order they are blacked out.
 * @remarks
 * Whole private key blocks come first, then token formats of well-known
 * services, then credentials in URLs, then `NAME=value` assignments of
 * environment variables and `password: value` style assignments. Every
 * assignment needs `=` or `:` right after the name, so ordinary text that
 * merely mentions a password or a token stays as it is.
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    pattern:
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/gu,
    replace: whole,
  },
  {
    pattern:
      /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|npm_[A-Za-z0-9]{30,})/gu,
    replace: whole,
  },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
    replace: whole,
  },
  {
    pattern: /\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{16,}/gu,
    replace: keepName,
  },
  {
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/giu,
    replace: (_: string, scheme: string): string => `${scheme}${MARK}@`,
  },
  {
    pattern:
      /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|CREDENTIALS?|AUTH)[A-Z0-9_]*\s*=\s*)("[^"\n]*"|'[^'\n]*'|[^\s"']+)/gu,
    replace: keepName,
  },
  {
    pattern:
      /\b((?:password|passwort|passwd|pwd|secret|geheimnis|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key)\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"',;]+)/giu,
    replace: keepName,
  },
];

/**
 * Blacks out the secrets Pages recognizes in a memory entry.
 * @param text - The text of an entry or of a snapshot.
 * @returns The text with every recognized secret replaced by
 * {@link PLAN_SWARM_MEMORY_REDACTED}, and whether anything was replaced.
 * @remarks
 * This is a best effort: it knows key and token formats, credentials in
 * URLs, secret environment variables and password assignments. It does not
 * replace care, and a secret in a form it does not know stays.
 */
export function redactSwarmMemoryText(text: string): {
  readonly text: string;
  readonly isRedacted: boolean;
} {
  let redacted = text;
  for (const secret of SECRET_PATTERNS)
    redacted = redacted.replace(secret.pattern, secret.replace);
  return { text: redacted, isRedacted: redacted !== text };
}
