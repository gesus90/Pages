import favicon from "@/assets/favicon.svg?raw";

/** Serves the Pages project favicon at the browser's conventional icon URL. */
export function loader(): Response {
  return new Response(favicon, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "image/svg+xml",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
