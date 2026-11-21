import type {
  AgentCheckDetail,
  ApiProviderId,
} from "@/definition/AgentConnection";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";

export type ProviderCheckOutcome =
  | { readonly ok: true; readonly detail: AgentCheckDetail }
  | {
      readonly ok: false;
      readonly errorCode: AgentErrorCode;
      readonly detail: AgentCheckDetail;
    };

export interface ModelTestRequest {
  readonly apiKey: string;
  readonly model: string;
  /** Only set when the stored catalog lists this effort for the model. */
  readonly reasoningEffort: string | null;
}

/** Each adapter performs exactly one explicit request, without retries or SDK state. */
export interface ApiProviderAdapter {
  readonly provider: ApiProviderId;
  checkAccess(
    apiKey: string,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome>;
  runModelTest(
    request: ModelTestRequest,
    signal: AbortSignal,
  ): Promise<ProviderCheckOutcome>;
}

export interface ProviderHttpResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

export interface ProviderHttpOptions {
  readonly method: "GET" | "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
  readonly redirect: "error";
}

export type ProviderHttpTransport = (
  url: string,
  options: ProviderHttpOptions,
) => Promise<ProviderHttpResponse>;
