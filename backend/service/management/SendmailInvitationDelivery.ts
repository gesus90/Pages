import { spawn } from "node:child_process";

import type { AccountInvitationDelivery } from "@/definition/Management";

/** Default mail adapter; operators can replace this dependency without changing account services. */
export class SendmailInvitationDelivery implements AccountInvitationDelivery {
  /** Sends credentials only to the person; no shell, request log or public result receives them. */
  public async send(invitation: {
    readonly email: string;
    readonly username: string;
    readonly temporaryPassword: string;
  }): Promise<void> {
    if (/[\r\n]/u.test(invitation.email))
      throw new Error("Invalid mail recipient");
    await new Promise<void>((resolve, reject) => {
      const process = spawn("sendmail", ["-t", "-i"], {
        stdio: ["pipe", "ignore", "ignore"],
      });
      process.once("error", () =>
        reject(new Error("Invitation delivery unavailable")),
      );
      process.stdin.once("error", () =>
        reject(new Error("Invitation delivery unavailable")),
      );
      process.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Invitation delivery failed")),
      );
      process.stdin.end(
        `To: ${invitation.email}\nSubject: Pages invitation / Einladung\nContent-Type: text/plain; charset=UTF-8\n\nPages\n\nUsername / Benutzername: ${invitation.username}\nTemporary password / Einmalpasswort: ${invitation.temporaryPassword}\n\nChange your password at sign-in. / Bitte beim Anmelden ein neues Passwort setzen.\n`,
      );
    });
  }
}
