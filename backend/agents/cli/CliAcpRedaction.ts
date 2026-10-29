import type { CliCredentialAccess } from "./CliContracts";
import type { CliGitHubAccess } from "./CliGitHubCredentials";

/** Masks the credentials carried by one ACP session before it records any text. */
export function createAcpRedactor(input: {
  readonly credentials?: CliCredentialAccess;
  readonly github: CliGitHubAccess | null;
  readonly tokens: readonly (string | undefined)[];
}): (text: string) => string {
  return (text) => {
    const withoutKey = input.credentials?.redact(text) ?? text;
    let masked = input.github?.redact(withoutKey) ?? withoutKey;
    for (const secret of input.tokens) {
      if (secret) masked = masked.replaceAll(secret, "[redacted]");
    }
    return masked;
  };
}
