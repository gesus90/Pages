/** Selects TLS unless the administrator explicitly selected LAN transport. */
export function runnerAddress(
  source: string,
  allowInsecureLan?: boolean,
): string;
/** Validates transport and binds the endpoint to its existing connection identity. */
export function runnerEndpoint(
  endpoint: string,
  options?: {
    readonly connectionId?: string;
    readonly isLocal?: boolean;
    readonly allowInsecureLan?: boolean;
  },
): string;
