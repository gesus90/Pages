import path from "node:path";

import { logCaughtError } from "@/backend/logging/Logger";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";

import { adminScope } from "../admin/PicaAdminFiles";
import { PicaAdminError } from "../admin/PicaAdminContracts";
import { launchPicaBrowser } from "../admin/PicaBrowserSandbox";
import { isAgentBrowserTool } from "./PicaBrowserContracts";
import { PicaOperatorBrowser } from "./PicaOperatorBrowser";

import type { RuntimeExecutionContext } from "@/backend/agents/runtime/RuntimeExecutionContext";
import type {
  PicaBrowserCommand,
  PicaBrowserOverview,
  PicaBrowserView,
} from "@/definition/PicaBrowser";
import type { PicaToolOutcome } from "../PicaToolSchemas";
import type { PicaBrowserTool } from "./PicaBrowserContracts";
import type { PicaBrowserFrame } from "./PicaBrowserSession";
import type {
  AgentBrowserLease,
  AgentBrowserSessions,
} from "./AgentBrowserSessions";
import type { PicaOperatorBrowserDependencies } from "./PicaOperatorBrowser";

/** Own-account browser path for employees with host access, separate from administrator scopes. */
export class AgentBrowserService {
  private readonly sessions: AgentBrowserSessions;
  private readonly browsers: PicaOperatorBrowser;
  private isChecking = false;
  private readonly leases = new Map<string, AgentBrowserLease>();

  /** Creates the employee browser manager on its own session authority. */
  public constructor(
    sessions: AgentBrowserSessions,
    options: Pick<PicaOperatorBrowserDependencies, "origins"> &
      Partial<Pick<PicaOperatorBrowserDependencies, "launch">>,
  ) {
    this.sessions = sessions;
    this.browsers = new PicaOperatorBrowser({
      ...options,
      launch: options.launch ?? launchPicaBrowser,
      store: null,
      readFile: () => Promise.reject(new PicaAdminError("SESSION_DENIED")),
      selfState: (context) => this.lease(context).storage,
      ownerName: (context) => this.lease(context).ownerName,
    });
    const timer = setInterval(() => void this.recheck(), 250);
    timer.unref();
    registerShutdownTask(
      async () => {
        clearInterval(timer);
        for (const lease of this.leases.values())
          await this.release(lease.context);
        await this.sessions.close();
      },
      { step: "agent_browsers" },
    );
  }

  /** Prepares the job's private state before starting its native session. */
  public async bind(
    context: RuntimeExecutionContext,
  ): Promise<RuntimeExecutionContext> {
    const lease = await this.sessions.issue(context);
    this.leases.set(adminScope(context), lease);
    return lease.context;
  }

  /** The stable private mount of this conversation; a kept native session sees renewed state. */
  public mount(context: RuntimeExecutionContext): string {
    return path.dirname(this.lease(context).file);
  }

  /** Instructions disclose only a file path, never its contents or an account password. */
  public usage(context: RuntimeExecutionContext): string {
    return `Browser profile self signs into Pages as your own agent account. For Playwright, pass storageState: ${JSON.stringify(this.lease(context).file)} to browser.newContext. This private file expires with this job. Never print, copy, attach or report its contents.`;
  }

  /** Runs only the non-administrative browser catalog, rechecking the bound agent before each call. */
  public async run(
    tool: PicaBrowserTool,
    input: unknown,
    context: RuntimeExecutionContext,
  ): Promise<PicaToolOutcome> {
    const lease = this.lease(context);
    await lease.context.authorize();
    if (!isAgentBrowserTool(tool))
      return { ok: false, result: null, error: "SESSION_DENIED" };
    return this.browsers.run(tool, input, lease.context);
  }

  /** Closes all browsers and revokes the state, whether the job succeeded, failed or was stopped. */
  public async release(context: RuntimeExecutionContext): Promise<void> {
    this.leases.delete(adminScope(context));
    try {
      await this.sessions.release(adminScope(context));
    } finally {
      await this.browsers.closeScope(context);
    }
  }

  /** Whether a browser belongs to this path; used only after the live route's administrator gate. */
  public has(browserId: string): boolean {
    return this.browsers.scopeOf(browserId) !== null;
  }

  /** All agent browsers for the existing administrator live view. */
  public overview(): Promise<PicaBrowserOverview> {
    return this.browsers.overview(null);
  }

  /** A live frame, for a caller already checked as administrator by the facade. */
  public frame(browserId: string): Promise<PicaBrowserFrame | null> {
    return this.browsers.frame(null, browserId);
  }

  /** Administrators may pause, resume or stop an agent; they cannot inject another account's profile. */
  public async command(
    browserId: string,
    command: PicaBrowserCommand,
    administratorId: string,
  ): Promise<PicaBrowserView> {
    if (
      !["pause", "resume", "stop", "approveLocalWrites"].includes(
        command.command,
      )
    )
      throw new PicaAdminError("SESSION_DENIED");
    const scope = this.browsers.scopeOf(browserId);
    const view = await this.browsers.command(
      null,
      browserId,
      command,
      administratorId,
    );
    const lease = scope ? this.leases.get(scope) : undefined;
    if (command.command === "stop" && lease) await this.release(lease.context);
    return view;
  }

  private lease(context: RuntimeExecutionContext): AgentBrowserLease {
    const lease = this.leases.get(adminScope(context));
    if (!lease || lease.context.signal.aborted)
      throw new PicaAdminError("SESSION_DENIED");
    return lease;
  }

  private async recheck(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;
    try {
      await Promise.all(
        [...this.leases.values()].map((lease) => this.checkLease(lease)),
      );
    } finally {
      this.isChecking = false;
    }
  }

  private async checkLease(lease: AgentBrowserLease): Promise<void> {
    try {
      await lease.context.authorize();
    } catch {
      await this.release(lease.context).catch((error: unknown) => {
        logCaughtError("AgentBrowserService", error);
      });
    }
  }
}
