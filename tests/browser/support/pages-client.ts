import type { z } from "zod";

/** The answer to a form post, as far as the seeding needs it. */
export interface FormAnswer {
  readonly status: number;
  readonly location: string | null;
  readonly text: string;
  readonly setCookies: readonly string[];
}

const SESSION_COOKIE = "pages_session";

/**
 * A plain HTTP client for the seeding of an isolated instance.
 *
 * @remarks
 * It speaks to Pages the way a browser form does, with the session cookie of
 * one account, and never follows redirects: the seeding reads what the server
 * answers. No cookie, token or password is logged.
 */
export class PagesClient {
  private readonly origin: string;
  private cookies: string;

  /**
   * Creates a client.
   *
   * @param origin - Address of the instance.
   * @param cookies - Cookie header to start with, such as the language cookie.
   */
  public constructor(origin: string, cookies = "") {
    this.origin = origin;
    this.cookies = cookies;
  }

  /** The session token of the signed-in account, or `null`. */
  public get sessionToken(): string | null {
    return (
      new RegExp(`${SESSION_COOKIE}=([^;]+)`, "u").exec(this.cookies)?.[1] ??
      null
    );
  }

  /**
   * Posts a form as the browser would and keeps a session cookie it sets.
   *
   * @param path - Route of the form action.
   * @param fields - Form fields.
   * @returns What the server answered.
   */
  public async postForm(
    path: string,
    fields: Readonly<Record<string, string>>,
  ): Promise<FormAnswer> {
    const response = await fetch(`${this.origin}${path}`, {
      body: new URLSearchParams(fields),
      headers: { cookie: this.cookies },
      method: "POST",
      redirect: "manual",
    });
    const setCookies = response.headers.getSetCookie();

    this.keepSession(setCookies);

    return {
      location: response.headers.get("location"),
      setCookies,
      status: response.status,
      text: await response.text(),
    };
  }

  /**
   * Reads a JSON route and checks its shape.
   *
   * @param path - Route to read.
   * @param schema - Shape the answer must have.
   * @returns The parsed answer.
   */
  public async getJson<Shape>(
    path: string,
    schema: z.ZodType<Shape>,
  ): Promise<Shape> {
    const response = await fetch(`${this.origin}${path}`, {
      headers: { cookie: this.cookies },
    });

    if (!response.ok) {
      throw new Error(`GET ${path} answered ${response.status}.`);
    }

    return schema.parse(await response.json());
  }

  /**
   * Reads a page as text.
   *
   * @param path - Route to read.
   * @returns The body of the answer.
   */
  public async getText(path: string): Promise<string> {
    const response = await fetch(`${this.origin}${path}`, {
      headers: { cookie: this.cookies },
    });

    return response.text();
  }

  /**
   * Sends a file as the plain body of a PUT request.
   *
   * @param path - Route with its query.
   * @param body - Bytes of the file.
   * @returns The status and the parsed JSON answer.
   */
  public async putFile(
    path: string,
    body: Buffer,
  ): Promise<{ readonly status: number; readonly json: unknown }> {
    const response = await fetch(`${this.origin}${path}`, {
      body: new Uint8Array(body),
      headers: { cookie: this.cookies },
      method: "PUT",
    });

    return { json: await response.json(), status: response.status };
  }

  /**
   * Posts a JSON body.
   *
   * @param path - Route to post to.
   * @param body - Payload.
   * @returns The status and the parsed JSON answer.
   */
  public async postJson(
    path: string,
    body: unknown,
  ): Promise<{ readonly status: number; readonly json: unknown }> {
    const response = await fetch(`${this.origin}${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: this.cookies },
      method: "POST",
    });

    return { json: await response.json(), status: response.status };
  }

  private keepSession(setCookies: readonly string[]): void {
    for (const header of setCookies) {
      const pair = header.split(";")[0] ?? "";
      const name = pair.split("=")[0];

      this.cookies = [
        ...this.cookies
          .split("; ")
          .filter((entry) => entry !== "" && !entry.startsWith(`${name}=`)),
        pair,
      ].join("; ");
    }
  }
}
