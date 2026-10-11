import { redirect } from "react-router";

import { getApplicationServices } from "@/app/lib/services.server";
import {
  oauthFailure,
  oauthResponse,
  readOAuthJson,
} from "@/app/lib/oauth-response.server";
import { McpAuthorizationError } from "@/backend/error/McpAuthorizationError";
import { readOAuthConfiguration } from "@/backend/service/mcp/OAuthConfiguration";

import type { Route } from "./+types/oauth-endpoint";

/** Starts authorization separately from client registration, before any Pages login. */
export async function loader({
  request,
  params,
}: Route.LoaderArgs): Promise<Response> {
  try {
    if (params.endpoint !== "authorize")
      throw new McpAuthorizationError("invalid_request", 405);
    readOAuthConfiguration(process.env);
    const services = await getApplicationServices();
    const id = await services.oauthConsentService.begin(
      new URL(request.url).searchParams,
    );
    return redirect(`/oauth/consent?id=${id}`, {
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}

/** Handles public client registration, PKCE/refresh exchange and dedicated token delegation. */
export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<Response> {
  try {
    if (request.method !== "POST" || request.headers.has("authorization"))
      throw new McpAuthorizationError("invalid_request");
    const configuration = readOAuthConfiguration(process.env);
    const services = await getApplicationServices();
    if (params.endpoint === "register")
      return oauthResponse(
        await services.oauthClientService.register(
          await readOAuthJson(request),
        ),
        201,
      );
    if (params.endpoint === "delegate") {
      const input = await readOAuthJson(request);
      if (
        typeof input.subject_token !== "string" ||
        input.resource !== configuration.resource
      )
        throw new McpAuthorizationError("invalid_token", 401);
      return oauthResponse(
        await services.oauthTokenService.delegate(
          input.subject_token,
          input.resource,
        ),
      );
    }
    if (
      params.endpoint !== "token" ||
      !request.headers
        .get("content-type")
        ?.startsWith("application/x-www-form-urlencoded")
    )
      throw new McpAuthorizationError("invalid_request");
    const body = await request.text();
    if (body.length > 65_536)
      throw new McpAuthorizationError("invalid_request");
    return oauthResponse(
      await services.oauthTokenService.exchange(new URLSearchParams(body)),
    );
  } catch (error: unknown) {
    return oauthFailure(error);
  }
}
