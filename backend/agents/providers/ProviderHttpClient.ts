import { sanitizeCheckDetail } from "@/backend/agents/AgentCheckDetail";
import { logEvent } from "@/backend/logging/Logger";
import { apiProviderEndpoint } from "@/definition/AgentConnection";

import { classifyProviderError } from "./ProviderErrors";

import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type {
  AgentCheckDetail,
  ApiProviderId,
  ZaiAccountType,
} from "@/definition/AgentConnection";
import type {
  ProviderCheckOutcome,
  ProviderHttpResponse,
  ProviderHttpTransport,
} from "./ProviderContracts";

interface ProviderRequest<Result> {
  readonly provider: ApiProviderId;
  readonly zaiAccountType?: ZaiAccountType;
  /**
   * A fixed endpoint of the provider outside its model API, such as a usage
   * monitor; it replaces the endpoint of the provider.
   */
  readonly endpoint?: string;
  /** Sends the key as the whole `Authorization` value, as the usage monitor of Z.AI requires. */
  readonly isKeySentWithoutScheme?: boolean;
  readonly apiKey: string;
  readonly path: string;
  readonly body?: Readonly<Record<string, unknown>>;
  readonly parse: (payload: unknown) => Result | null;
}

/** The parsed fields of a provider response, or its classified failure. */
export type ProviderReadOutcome<Result> =
  | { readonly ok: true; readonly value: Result }
  | { readonly ok: false; readonly errorCode: AgentErrorCode };

/** Builds provider-native authentication headers; keys never enter URLs. */
export function requestHeaders(
  provider: ApiProviderId,
  apiKey: string,
  options: { readonly isKeySentWithoutScheme?: boolean } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (provider === "google_ai_studio") headers["x-goog-api-key"] = apiKey;
  else if (provider === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else
    headers.Authorization = options.isKeySentWithoutScheme
      ? apiKey
      : `Bearer ${apiKey}`;
  return headers;
}

/** Sends bounded, non-retrying provider requests and returns only whitelisted outcomes. */
export class ProviderHttpClient {
  private readonly request: ProviderHttpTransport;

  public constructor(request: ProviderHttpTransport = fetch) {
    this.request = request;
  }

  /** Keys exist only in headers; redirects cannot forward them to another host. */
  public async check(
    input: ProviderRequest<AgentCheckDetail>,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome> {
    const result = await this.read(input, signal);
    const detail = {
      endpoint: new URL(
        apiProviderEndpoint(input.provider, input.zaiAccountType),
      ).hostname,
    };
    if (!result.ok) return { ...result, detail };
    return {
      ok: true,
      detail: { ...sanitizeCheckDetail(result.value), ...detail },
    };
  }

  /** Reads and validates a provider response without exposing its raw payload. */
  public async read<Result>(
    input: ProviderRequest<Result>,
    signal: AbortSignal,
  ): Promise<ProviderReadOutcome<Result>> {
    const endpoint =
      input.endpoint ??
      apiProviderEndpoint(input.provider, input.zaiAccountType);
    let response: ProviderHttpResponse;
    try {
      signal.throwIfAborted();
      response = await this.request(`${endpoint}${input.path}`, {
        method: input.body === undefined ? "GET" : "POST",
        headers: requestHeaders(input.provider, input.apiKey, {
          isKeySentWithoutScheme: input.isKeySentWithoutScheme,
        }),
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal,
        redirect: "error",
      });
      logEvent({
        level: response.status < 400 ? "debug" : "warn",
        event: "integration.provider.response",
        component: "ProviderHttpClient",
        message: "Provider check response received",
        metadata: { provider: input.provider, statusCode: response.status },
      });
    } catch {
      return {
        ok: false,
        errorCode: signal.aborted ? "check_timeout" : "provider_unreachable",
      };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return {
        ok: false,
        errorCode: signal.aborted
          ? "check_timeout"
          : (classifyProviderError(response.status, null) ??
            "provider_bad_response"),
      };
    }
    if (signal.aborted) return { ok: false, errorCode: "check_timeout" };
    const errorCode = classifyProviderError(response.status, payload);
    if (errorCode) return { ok: false, errorCode };
    const parsed = input.parse(payload);
    if (parsed === null)
      return { ok: false, errorCode: "provider_bad_response" };
    return { ok: true, value: parsed };
  }
}
