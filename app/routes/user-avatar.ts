import { getApplicationServices } from "@/app/lib/services.server";
import type { Route } from "./+types/user-avatar";

/** Returns a user's custom avatar image as a binary response. */
export async function loader({
  params,
  request,
}: Route.LoaderArgs): Promise<Response> {
  if (request.method !== "GET") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "GET" },
      status: 405,
    });
  }

  const userId = params.userId;

  if (!userId) {
    throw new Response("Not Found", { status: 404 });
  }

  const services = await getApplicationServices();
  const avatar = await services.userService.getAvatar(userId);

  if (!avatar) {
    throw new Response("Not Found", { status: 404 });
  }

  return new Response(new Uint8Array(avatar.data), {
    headers: {
      "Cache-Control": "private, max-age=300",
      "Content-Type": avatar.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
