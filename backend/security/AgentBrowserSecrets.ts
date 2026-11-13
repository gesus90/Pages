/** Masks the issued browser token, its cookie encoding and private runtime paths. */
export function redactAgentBrowserSecrets(text: string): string {
  return text
    .replace(/\bpabs_[A-Za-z0-9_-]+/gu, "[redacted]")
    .replace(/InBhYnNf[A-Za-z0-9+/]*={0,2}/gu, "[redacted]")
    .replace(/\/[^\s"'<>]*pages-agent-browser-[^\s"'<>]*/gu, "[redacted]");
}

/** Detects issued session material before a file can become an attachment. */
export function containsAgentBrowserSecret(text: string): boolean {
  return redactAgentBrowserSecrets(text) !== text;
}
