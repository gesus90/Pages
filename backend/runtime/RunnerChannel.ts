import { WebSocketServer } from "ws";
import { getApplicationServices } from "@/app/lib/services.server";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { registerShutdownTask } from "./ProcessLifecycle";
import { isRemoteConsoleChannel } from "./RemoteConsoleChannel";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import type { WebSocket } from "ws";
import type { RunnerRegistrationReply } from "@/definition/RunnerProtocol";
import type { RunnerGitHubAccessService } from "@/backend/service/runner/RunnerGitHubAccessService";
import type { RunnerOpenRouterService } from "@/backend/service/runner/RunnerOpenRouterService";
import type {
  RunnerAuthentication,
  RunnerService,
} from "@/backend/service/runner/RunnerService";

const CHANNEL_PATH = /^\/runner\/v1\/channel\/([a-f0-9-]{36})$/u;
const MAXIMUM_PAYLOAD = 2 * 1024 * 1024;

/** One notice per interval, so a peer that keeps trying cannot flood the log. */
const REJECTION_NOTICE_MILLISECONDS = 30_000;
let lastRejectionNotice = 0;

/** Makes a peer that presented no valid credential visible to the operator, without the credential. */
function noticeRejectedPeer(): void {
  if (Date.now() - lastRejectionNotice < REJECTION_NOTICE_MILLISECONDS) return;
  lastRejectionNotice = Date.now();
  logEvent({
    level: "warn",
    event: "runner.channel.rejected",
    component: "RunnerChannel",
    message:
      "Refused a runner connection without a valid registration or credential",
  });
}

import type { RunnerPagesAccessService } from "@/backend/service/runner/RunnerPagesAccessService";

interface RunnerChannelServices {
  readonly pages: RunnerPagesAccessService;
  readonly runners: RunnerService;
  readonly openRouter: RunnerOpenRouterService;
  readonly github: RunnerGitHubAccessService;
}

async function receiveAuxiliary(
  connectionId: string,
  input: unknown,
  services: RunnerChannelServices,
  send: (reply: unknown) => void,
): Promise<boolean> {
  if (typeof input !== "object" || input === null || !("type" in input))
    return false;
  if (input.type === "pages-request") {
    send(await services.pages.receive(connectionId, input));
    return true;
  }
  if (input.type === "github-access-result") {
    services.github.receive(connectionId, input);
    return true;
  }
  if (input.type === "openrouter-result") {
    services.openRouter.receive(connectionId, input);
    return true;
  }
  return false;
}

function attach(
  socket: WebSocket,
  auth: RunnerAuthentication,
  services: RunnerChannelServices,
  isCurrent: () => boolean,
): void {
  const queue = new SerialQueue();
  const service = services.runners;
  let detachGitHub: (() => void) | undefined;
  let detachProvider: (() => void) | undefined;
  let lastSeen = Date.now();
  let hasReconciled = false;
  let pendingMessages = 0;
  service.disconnected(auth.connectionId);
  const timer = setInterval(() => {
    if (Date.now() - lastSeen > 45_000) socket.terminate();
  }, 15_000);
  timer.unref();
  const registration: RunnerRegistrationReply = {
    version: 1,
    type: "registered",
    ...auth,
    heartbeatMilliseconds: 15_000,
  };
  socket.send(JSON.stringify(registration));
  socket.on("message", (buffer, isBinary) => {
    if (pendingMessages >= 32) {
      socket.close(1008, "Runner queue limit");
      return;
    }
    pendingMessages += 1;
    void queue.run(async () => {
      try {
        if (!isCurrent()) throw new Error("Runner channel superseded");
        if (isBinary) throw new Error("Runner text messages required");
        const input: unknown = JSON.parse(buffer.toString());
        if (
          hasReconciled &&
          (await receiveAuxiliary(auth.connectionId, input, services, (reply) =>
            socket.send(JSON.stringify(reply)),
          ))
        )
          return;
        if (
          !hasReconciled &&
          (typeof input !== "object" ||
            input === null ||
            !("type" in input) ||
            input.type !== "reconcile")
        )
          throw new Error("Runner reconciliation required");
        const reply = await service.receive(auth.connectionId, input);
        hasReconciled = true;
        detachProvider ??= services.openRouter.attach(
          auth.connectionId,
          (command) => {
            if (!isCurrent()) throw new Error("Runner channel superseded");
            socket.send(JSON.stringify(command));
          },
        );
        detachGitHub ??= services.github.attach(
          auth.connectionId,
          (command) => {
            if (!isCurrent()) throw new Error("Runner channel superseded");
            socket.send(JSON.stringify(command));
          },
        );
        service.attach(auth.connectionId, (command) => {
          if (!isCurrent()) throw new Error("Runner channel superseded");
          socket.send(JSON.stringify(command));
        });
        lastSeen = Date.now();
        socket.send(JSON.stringify(reply));
      } catch {
        socket.close(1008, "Invalid runner protocol or authorization");
      } finally {
        pendingMessages -= 1;
      }
    });
  });
  socket.on("error", (error) => logCaughtError("RunnerChannel", error));
  socket.once("close", () => {
    clearInterval(timer);
    detachProvider?.();
    detachGitHub?.();
    if (isCurrent()) service.detach(auth.connectionId);
    if (isCurrent()) service.disconnected(auth.connectionId);
  });
}

async function upgrade(input: {
  readonly request: IncomingMessage;
  readonly socket: Duplex;
  readonly head: Buffer;
  readonly server: WebSocketServer;
  readonly active: Map<string, WebSocket>;
}): Promise<void> {
  const { request, socket, server } = input;
  try {
    const connectionId = CHANNEL_PATH.exec(request.url ?? "")?.[1];
    if (server.clients.size >= 200) throw new Error("Runner channel limit");
    const protocols = request.headers["sec-websocket-protocol"]
      ?.split(",")
      .map((item) => item.trim());
    const credential = protocols
      ?.find((item) => item.startsWith("credential."))
      ?.slice(11);
    if (
      !connectionId ||
      !credential ||
      request.headers.origin ||
      !protocols?.includes("pages-runner.v1")
    )
      throw new Error("Runner authorization required");
    const services = await getApplicationServices();
    const service = services.runnerService;
    const auth = await service.authenticate(connectionId, credential);
    server.handleUpgrade(request, socket, input.head, (channel) => {
      const previous = input.active.get(connectionId);
      previous?.terminate();
      input.active.set(connectionId, channel);
      attach(
        channel,
        auth,
        {
          pages: services.runnerPagesAccessService,
          runners: service,
          openRouter: services.runnerOpenRouterService,
          github: services.runnerGitHubAccessService,
        },
        () => input.active.get(connectionId) === channel,
      );
      channel.once("close", () => {
        if (input.active.get(connectionId) === channel)
          input.active.delete(connectionId);
      });
    });
  } catch {
    noticeRejectedPeer();
    socket.end(
      "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  }
}

/** Installs an authenticated WS/WSS endpoint; browser-origin upgrades are refused. */
export function installRunnerChannel(server: Server): void {
  const websocket = new WebSocketServer({
    noServer: true,
    maxPayload: MAXIMUM_PAYLOAD,
    handleProtocols: () => "pages-runner.v1",
  });
  const active = new Map<string, WebSocket>();
  server.on("upgrade", (request, socket, head) => {
    // The console channel answers its own upgrades.
    if (isRemoteConsoleChannel(request.url)) return;
    const deadline = setTimeout(() => socket.destroy(), 10_000);
    void upgrade({
      request,
      socket,
      head,
      server: websocket,
      active,
    }).finally(() => clearTimeout(deadline));
  });
  registerShutdownTask(() => {
    for (const channel of websocket.clients) channel.terminate();
    websocket.close();
    return Promise.resolve();
  });
}
