/** Validated instance URL and opaque Bearer credential; not an authenticated identity. */
export interface PagesConfiguration {
  readonly agentsUrl: URL;
  readonly token: string;
}

/**
 * Reads only the two supported settings and reports errors without their contents.
 * HTTPS is required except for an HTTP loopback instance.
 */
export function readConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): PagesConfiguration {
  const pagesUrl = environment.PAGES_URL;
  const token = environment.PAGES_TOKEN;
  if (!pagesUrl || pagesUrl.trim() !== pagesUrl) {
    throw new Error("PAGES_URL must be an absolute HTTP(S) instance URL.");
  }
  let baseUrl: URL;
  try {
    baseUrl = new URL(pagesUrl);
  } catch {
    throw new Error("PAGES_URL must be an absolute HTTP(S) instance URL.");
  }
  const isLoopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    baseUrl.hostname,
  );
  if (
    (baseUrl.protocol !== "https:" &&
      !(baseUrl.protocol === "http:" && isLoopback)) ||
    baseUrl.username !== "" ||
    baseUrl.password !== "" ||
    baseUrl.search !== "" ||
    baseUrl.hash !== ""
  ) {
    throw new Error(
      "PAGES_URL requires HTTPS (or HTTP on loopback), without credentials, query or fragment.",
    );
  }
  if (!token || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
    throw new Error(
      "PAGES_TOKEN must be a nonempty Bearer credential without whitespace.",
    );
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/api/v1/agents`;
  return { agentsUrl: baseUrl, token };
}
