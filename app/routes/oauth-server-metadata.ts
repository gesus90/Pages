import { oauthFailure, oauthResponse } from "@/app/lib/oauth-response.server";
import {
  authorizationMetadata,
  readOAuthConfiguration,
} from "@/backend/service/mcp/OAuthConfiguration";

/** Publishes the explicitly configured Pages authorization server's discovery document. */
export function loader(): Response {
  try {
    return oauthResponse(
      authorizationMetadata(readOAuthConfiguration(process.env)),
    );
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}
