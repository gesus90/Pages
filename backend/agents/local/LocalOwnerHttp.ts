import { createServer } from "node:http";
import { chmod, lstat, unlink } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";

import { localCommandSchema } from "./LocalSessionContracts";
import { localSessionSocket } from "./LocalSessionTransport";

import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type {
  LocalOwnerManifest,
  LocalSessionCommand,
} from "./LocalSessionContracts";
import type { LocalOwnerSession } from "./LocalOwnerSession";
import type { LocalSessionJournal } from "./LocalSessionJournal";

/** Authenticated Unix IPC for the actual native owner; it opens no network listener. */
export class LocalOwnerHttp {
  private readonly manifest: LocalOwnerManifest;
  private readonly session: LocalOwnerSession;
  private readonly journal: LocalSessionJournal;
  private readonly release: () => Promise<void>;
  private readonly server: Server;
  private attachment: string | null = null;
  private readonly commands = new SerialQueue();

  public constructor(
    manifest: LocalOwnerManifest,
    session: LocalOwnerSession,
    journal: LocalSessionJournal,
    release: () => Promise<void>,
  ) {
    this.manifest = manifest;
    this.session = session;
    this.journal = journal;
    this.release = release;
    this.server = createServer((request, response) => {
      void this.receive(request, response);
    });
  }

  /** Binds once with a private mode; an existing socket is never replaced or claimed. */
  public async listen(): Promise<void> {
    const socket = localSessionSocket(this.manifest);
    const previousMask = process.umask(0o077);
    try {
      await new Promise<void>((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(socket, () => {
          this.server.removeListener("error", reject);
          resolve();
        });
      });
      await chmod(socket, 0o600);
    } finally {
      process.umask(previousMask);
    }
  }

  /** Removes only this listener's own socket after its server has stopped. */
  public async close(): Promise<void> {
    if (!this.server.listening) return;
    const socket = localSessionSocket(this.manifest);
    const before = await lstat(socket);
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
    try {
      const after = await lstat(socket);
      if (after.ino === before.ino && after.uid === before.uid)
        await unlink(socket);
    } catch (error: unknown) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }

  private async receive(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (
        request.method !== "POST" ||
        request.url !== "/" ||
        !this.authorized(request.headers.authorization)
      ) {
        response.writeHead(403).end();
        return;
      }
      const body = await this.body(request);
      const command = localCommandSchema.parse(JSON.parse(body));
      if (
        command.kind !== "attach" &&
        request.headers["x-pages-attachment"] !== this.attachment
      )
        throw new Error("Stale local attachment");
      const result = await this.commands.run(async () => {
        if (
          command.kind !== "attach" &&
          request.headers["x-pages-attachment"] !== this.attachment
        )
          throw new Error("Stale local attachment");
        return this.execute(command);
      });
      response.writeHead(200, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify(result));
      if (command.kind === "release") {
        await this.close();
        await this.release();
      }
    } catch (error: unknown) {
      if (response.headersSent) {
        response.end();
        return;
      }
      const code =
        error instanceof AgentError ? error.code : "plan_local_control_failed";
      response.writeHead(409, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      response.end(JSON.stringify({ error: code }));
    }
  }

  private authorized(header: string | undefined): boolean {
    const received = Buffer.from(header ?? "");
    const expected = Buffer.from(`Bearer ${this.manifest.capability}`);
    return (
      received.length === expected.length && timingSafeEqual(received, expected)
    );
  }

  private async body(request: IncomingMessage): Promise<string> {
    let body = "";
    request.setEncoding("utf8");
    for await (const chunk of request) {
      if (typeof chunk !== "string")
        throw new Error("Invalid local request body");
      body += chunk;
      if (Buffer.byteLength(body) > 1024 * 1024)
        throw new Error("Local request is too large");
    }
    return body;
  }

  private async execute(command: LocalSessionCommand): Promise<unknown> {
    switch (command.kind) {
      case "attach":
        this.attachment = command.token;
        return { ok: true };
      case "bearer":
        this.session.receiveBearer(command.token);
        return { ok: true };
      case "read":
        return {
          records: await this.journal.page(command.after, command.limit),
        };
      case "ack":
        await this.journal.acknowledge(command.sequence, command.digest);
        return { ok: true };
      case "next":
        await this.session.next(command.launch);
        return { ok: true };
      case "steer":
        return {
          outcome: await this.session.steer(command.prompt, command.commandId),
        };
      case "cancel":
        await this.session.cancel();
        return { ok: true };
      case "interrupt":
        return { interrupted: await this.session.interrupt() };
      case "close":
        return { closed: await this.session.close() };
      case "release":
        return this.confirmRelease();
    }
  }

  private async confirmRelease(): Promise<unknown> {
    const closed = await this.session.close();
    if (!closed.isConfirmed) throw new Error("Native cleanup is unconfirmed");
    return { closed };
  }
}
