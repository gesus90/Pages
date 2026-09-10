import { redirect } from "react-router";

import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import {
  ProjectAccessDeniedError,
  ProjectManagementDeniedError,
  ProjectNotFoundError,
} from "@/backend/service/ProjectService";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

const MAXIMUM_ICON_SIZE = 2 * 1024 * 1024;

const SUPPORTED_ICON_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function getProjectId(projectId: string | undefined): string {
  if (!projectId) {
    throw new Response("Not Found", { status: 404 });
  }

  return projectId;
}

function getActor(
  context: LoaderFunctionArgs["context"] | ActionFunctionArgs["context"],
) {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Response("Forbidden", { status: 403 });
  }

  return user;
}

/** Returns a project's protected custom icon as a binary image response. */
export async function loader({
  context,
  params,
  request,
}: LoaderFunctionArgs): Promise<Response> {
  if (request.method !== "GET") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "GET" },
      status: 405,
    });
  }

  try {
    const services = await getApplicationServices();
    const icon = await services.projectService.getIcon(
      getActor(context),
      getProjectId(params.projectId),
    );

    if (!icon) {
      throw new Response("Not Found", { status: 404 });
    }

    return new Response(new Uint8Array(icon.data), {
      headers: {
        "Cache-Control": "private, max-age=300",
        "Content-Type": icon.mimeType,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ProjectNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }

    if (error instanceof ProjectAccessDeniedError) {
      throw new Response("Forbidden", { status: 403 });
    }

    throw error;
  }
}

/** Validates and persistently replaces a project's custom icon. */
export async function action({
  context,
  params,
  request,
}: ActionFunctionArgs): Promise<Response> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const formData = await request.formData();
  const icon = formData.get("icon");

  if (!(icon instanceof File) || !SUPPORTED_ICON_TYPES.has(icon.type)) {
    throw new Response("Unsupported image type", { status: 400 });
  }

  if (!icon.size || icon.size > MAXIMUM_ICON_SIZE) {
    throw new Response("Invalid image size", { status: 400 });
  }

  const projectId = getProjectId(params.projectId);

  try {
    const services = await getApplicationServices();
    await services.projectService.replaceIcon(getActor(context), projectId, {
      data: Buffer.from(await icon.arrayBuffer()),
      filename: icon.name || "project-icon",
      mimeType: icon.type,
    });
  } catch (error: unknown) {
    if (error instanceof ProjectNotFoundError) {
      throw new Response("Not Found", { status: 404 });
    }

    if (
      error instanceof ProjectAccessDeniedError ||
      error instanceof ProjectManagementDeniedError
    ) {
      throw new Response("Forbidden", { status: 403 });
    }

    throw error;
  }

  return redirect(`/projekte/${encodeURIComponent(projectId)}`);
}
