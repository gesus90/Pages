/** Supported terminal commands, shared by startup and argument parsing. */
export const CREDENTIAL_COMMANDS = [
  "pair",
  "rotate",
  "unpair",
  "status",
] as const;

/** Terminal command recognized before the stdio server is started. */
export type CredentialCommand = (typeof CREDENTIAL_COMMANDS)[number];

/** Recognizes supported commands without changing the CLI failure mapping. */
export function isCredentialCommand(
  input: unknown,
): input is CredentialCommand {
  return CREDENTIAL_COMMANDS.some((command) => command === input);
}
