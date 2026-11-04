/**
 * The fixed program of a Git closeout, frozen in the run like script content.
 *
 * @remarks
 * It runs under Node.js in the process boundary of script nodes, reads one JSON
 * object on stdin and writes one `AgentPlanGitCloseoutResult` on stdout; exit 0
 * means `status` is `done`. Git and check output go to stderr, the diagnostic
 * stream, so a check cannot put text into the result.
 *
 * Every stop before the push restores the state it found: the commits as they
 * were, and uncommitted changes uncommitted again. A repeat therefore decides
 * anew whether a rebase changes the state and never publishes an unchecked one.
 * A marker in the Git directory covers what no restore can: a check the process
 * limit ended is due again, although the rebased state then looks integrated.
 */
export const PLAN_GIT_CLOSEOUT_SOURCE = String.raw`"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REMOTE_MAIN = "refs/remotes/origin/main";
const MAIN_REFSPEC = "+refs/heads/main:" + REMOTE_MAIN;
const MAX_REINTEGRATIONS = 3;
const MAX_BUFFER = 1024 * 1024 * 1024;
const MAX_FILES = 200;
const LOG_TAIL = 16000;
const OPERATION_MARKERS = ["rebase-merge", "rebase-apply", "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG"];
// High-confidence shapes only: a word like "password" in a changed line must not stop a release.
const SECRET_LINE = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[A-Z0-9]{16}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;
const SECRET_FILE = /(^|\/)(\.env(\.(?!example$|sample$|template$)[^/]*)?|id_(rsa|dsa|ecdsa|ed25519)|[^/]*\.(pem|p12|pfx)|\.netrc)$/;
const REFUSED = /Authentication failed|could not read Username|could not read Password|Invalid username|Permission to |Permission denied|not granted|Repository not found|error: 401|error: 403|Pages Git bridge refused|Host key verification failed/;
const CHECK_ENVIRONMENT_HIDDEN = /^(GIT_|GH_|SSH_ASKPASS$|PAGES_GIT|DBUS_SESSION_BUS_ADDRESS$)/;

class Stop extends Error {
  constructor(reason, message, files) {
    super(message);
    this.reason = reason;
    this.files = files;
  }
}

const result = {
  status: "done",
  commitSha: null,
  baseSha: null,
  remoteMainSha: null,
  pushVerified: false,
  noOp: false,
  rebased: false,
  integrations: 0,
  checkRan: false,
  workBranchDeleted: false,
};
let work = null;
let isPushed = false;

function log(text) {
  if (text) process.stderr.write(text + "\n");
}

function git(args, input) {
  const run = spawnSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    input,
    maxBuffer: MAX_BUFFER,
    env: { ...process.env, GIT_EDITOR: "true", GIT_SEQUENCE_EDITOR: "true", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
  });
  if (run.error) throw run.error;
  return { isOk: run.status === 0, stdout: (run.stdout || "").trim(), stderr: (run.stderr || "").trim() };
}

function must(args, stop, input) {
  const run = git(args, input);
  if (!run.isOk) {
    log(run.stderr);
    throw new Stop(stop[0], stop[1]);
  }
  return run.stdout;
}

function revision(name) {
  return must(["rev-parse", "--verify", name], ["commit_failed", "A revision could not be read: " + name]);
}

function isAncestor(ancestor, descendant) {
  return git(["merge-base", "--is-ancestor", ancestor, descendant]).isOk;
}

function pathList(output) {
  return output.split("\0").filter(Boolean).slice(0, MAX_FILES);
}

function changedFiles() {
  return git(["status", "--porcelain"]).stdout.split("\n").filter(Boolean).map((line) => line.slice(3)).slice(0, MAX_FILES);
}

function gitPath(name) {
  return must(["rev-parse", "--git-path", name], ["workspace_mismatch", "The workspace is no Git working copy."]);
}

function remoteRefusal(output) {
  log(output);
  if (REFUSED.test(output)) return new Stop("permission_denied", "The remote refused this credential. Nothing was changed there.");
  if (output.includes("couldn't find remote ref")) return new Stop("remote_mismatch", "origin has no branch main.");
  return new Stop("remote_unreachable", "The remote could not be reached.");
}

function fetchMain() {
  const run = git(["fetch", "--no-tags", "origin", MAIN_REFSPEC]);
  if (!run.isOk) throw remoteRefusal(run.stderr);
}

function repositoryOf(url) {
  const parts = url.replace(/\/+$/, "").replace(/\.git$/i, "").split(/[/:]/).filter(Boolean);
  return parts.slice(-2).join("/").toLowerCase();
}

function requireRemote(repository) {
  const urls = git(["config", "--get-all", "remote.origin.url"]);
  if (!urls.isOk || !urls.stdout) throw new Stop("remote_missing", "The workspace has no remote origin.");
  const pushUrls = git(["config", "--get-all", "remote.origin.pushurl"]);
  const all = [urls.stdout, pushUrls.isOk ? pushUrls.stdout : ""].join("\n").split("\n").filter(Boolean);
  // A host alias of the account is as valid as the host name, so only owner and name decide.
  if (!all.every((url) => repositoryOf(url) === repository.toLowerCase()))
    throw new Stop("remote_mismatch", "origin is not the repository of the project: " + repository + ".");
}

function requireWorkspace(input) {
  const top = must(["rev-parse", "--show-toplevel"], ["workspace_mismatch", "The workspace is no Git working copy."]);
  if (fs.realpathSync(top) !== fs.realpathSync(process.cwd()))
    throw new Stop("workspace_mismatch", "The workspace is not the top level of its Git working copy.");
  requireRemote(input.repository);
  const branch = git(["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!branch.isOk) throw new Stop("branch_mismatch", "HEAD is detached; expected the branch " + input.workBranch + ".");
  if (["main", "master"].includes(input.workBranch) || branch.stdout !== input.workBranch)
    throw new Stop("branch_mismatch", "The active branch is " + branch.stdout + "; expected a work branch named " + input.workBranch + ".");
  if (OPERATION_MARKERS.some((name) => fs.existsSync(gitPath(name))) || git(["ls-files", "--unmerged"]).stdout)
    throw new Stop("operation_in_progress", "An unfinished Git operation or unmerged files are in the workspace.");
}

function captureWork(message) {
  const head = revision("HEAD");
  const isDirty = git(["status", "--porcelain"]).stdout !== "";
  if (!isDirty && isAncestor(head, REMOTE_MAIN)) return null;
  // Only a commit that holds every change makes the restore safe; until then nothing may be reset hard.
  if (isDirty) {
    must(["add", "-A"], ["commit_failed", "The changes could not be staged."]);
    const commit = git(["commit", "--no-verify", "-F", "-"], message);
    if (!commit.isOk) {
      log(commit.stderr);
      git(["reset", "--mixed"]);
      throw new Stop("commit_failed", "The changes could not be committed; check the Git identity.");
    }
  }
  work = { head, isDirty, snapshot: revision("HEAD") };
  return work;
}

function squash(message) {
  const base = git(["merge-base", "HEAD", REMOTE_MAIN]);
  if (!base.isOk) throw new Stop("unrelated_history", "The work branch shares no history with origin/main.");
  must(["reset", "--soft", base.stdout], ["commit_failed", "The commits could not be combined."]);
  if (git(["diff", "--cached", "--quiet"]).isOk) return false;
  must(["commit", "-F", "-"], ["commit_failed", "The commit failed, for example in a hook or without a Git identity."], message);
  return true;
}

function integrate() {
  if (isAncestor(REMOTE_MAIN, "HEAD")) return false;
  const before = revision("HEAD^{tree}");
  const rebase = git(["rebase", "--no-autostash", REMOTE_MAIN]);
  result.rebased = true;
  if (!rebase.isOk) {
    log(rebase.stderr);
    const files = pathList(git(["diff", "--name-only", "--diff-filter=U", "-z"]).stdout);
    if (files.length === 0) throw new Stop("commit_failed", "The rebase failed without a conflict; see the diagnostics.");
    throw new Stop("rebase_conflict", "The rebase on origin/main has conflicts. This node does not resolve them.", files);
  }
  return revision("HEAD^{tree}") !== before;
}

function requireNoSecrets(base) {
  const hits = new Set(pathList(git(["diff", "--name-only", "--diff-filter=d", "-z", base, "HEAD"]).stdout).filter((file) => SECRET_FILE.test(file)));
  let current = null;
  let previous = "";
  for (const line of git(["diff", "--no-color", "--no-ext-diff", "--unified=0", base, "HEAD"]).stdout.split("\n")) {
    if (line.startsWith("+++ ") && previous.startsWith("--- ")) current = line.slice(4).replace(/^b\//, "");
    else if (line.startsWith("+") && SECRET_LINE.test(line)) hits.add(current);
    previous = line;
  }
  if (hits.size > 0)
    throw new Stop("secrets_detected", "The diff contains credential-shaped content. Only the files are named here.", [...hits].slice(0, MAX_FILES));
}

function runCheck(command, marker) {
  fs.writeFileSync(marker, revision("HEAD^{tree}") + "\n");
  const logFile = path.join(os.tmpdir(), "pages-git-closeout-check.log");
  const descriptor = fs.openSync(logFile, "w", 0o600);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !CHECK_ENVIRONMENT_HIDDEN.test(key)));
  const run = spawnSync("/bin/sh", ["-c", command], { stdio: ["ignore", descriptor, descriptor], env });
  fs.closeSync(descriptor);
  result.checkRan = true;
  if (run.status !== 0) {
    log(fs.readFileSync(logFile, "utf8").slice(-LOG_TAIL));
    throw new Stop("check_failed", "The check command failed with exit code " + run.status + ". Nothing was pushed.");
  }
  fs.rmSync(marker, { force: true });
}

function requireCleanTree() {
  const files = changedFiles();
  if (files.length > 0) throw new Stop("check_dirtied", "The check or a hook changed files. Nothing was pushed.", files);
}

function push() {
  const run = git(["push", "--porcelain", "origin", "HEAD:refs/heads/main"]);
  if (run.isOk) return true;
  const output = run.stdout + "\n" + run.stderr;
  if (/\[rejected\]|non-fast-forward|fetch first|stale info/.test(output)) {
    log(output);
    return false;
  }
  if (output.includes("[remote rejected]")) {
    log(output);
    throw new Stop("permission_denied", "The remote refused the update, for example through branch protection.");
  }
  throw remoteRefusal(output);
}

function verifyPush(commit) {
  const remote = git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]);
  if (!remote.isOk) {
    log(remote.stderr);
    throw new Stop("push_unverified", "The remote main could not be read after the push. The work branch stays.");
  }
  result.remoteMainSha = remote.stdout.split(/\s/)[0];
  const fetched = git(["fetch", "--no-tags", "origin", MAIN_REFSPEC]);
  if (!fetched.isOk || !isAncestor(commit, REMOTE_MAIN)) {
    log(fetched.stderr);
    throw new Stop("push_unverified", "The remote main does not show the commit. The work branch stays.");
  }
  result.pushVerified = true;
}

function cleanUp(branch) {
  const failure = ["cleanup_failed", "The commit is published, but the local cleanup did not finish."];
  must(["switch", "main"], failure);
  must(["merge", "--ff-only", REMOTE_MAIN], failure);
  must(["branch", "-d", branch], failure);
  result.workBranchDeleted = true;
  if (changedFiles().length > 0) throw new Stop(failure[0], failure[1], changedFiles());
}

function finishNoOp(marker) {
  fs.rmSync(marker, { force: true });
  result.noOp = true;
  result.baseSha = revision(REMOTE_MAIN);
  result.remoteMainSha = result.baseSha;
}

function restore(marker) {
  fs.rmSync(marker, { force: true });
  if (fs.existsSync(gitPath("rebase-merge")) || fs.existsSync(gitPath("rebase-apply"))) git(["rebase", "--abort"]);
  const reset = git(["reset", "--hard", work.snapshot]);
  const unstaged = work.isDirty ? git(["reset", "--mixed", work.head]) : reset;
  if (!reset.isOk || !unstaged.isOk) {
    log(reset.stderr + "\n" + unstaged.stderr);
    throw new Error("All work is held by commit " + work.snapshot + ", but the state before this step could not be restored.");
  }
}

function publish(input, marker) {
  requireWorkspace(input);
  fetchMain();
  const message = "(" + input.ticketKey + ") " + input.ticketTitle.replace(/[\u0000-\u001f\u007f]+/g, " ").trim() + "\n";
  result.baseSha = revision(REMOTE_MAIN);
  if (!captureWork(message) || !squash(message)) return finishNoOp(marker);
  let needsCheck = fs.existsSync(marker);
  for (;;) {
    if (integrate()) needsCheck = true;
    result.baseSha = revision(REMOTE_MAIN);
    if (revision("HEAD") === result.baseSha) return finishNoOp(marker);
    requireNoSecrets(result.baseSha);
    if (needsCheck) runCheck(input.checkCommand, marker);
    needsCheck = false;
    requireCleanTree();
    if (push()) break;
    if (result.integrations >= MAX_REINTEGRATIONS)
      throw new Stop("remote_diverged", "origin/main kept moving through " + MAX_REINTEGRATIONS + " integrations. Nothing was pushed.");
    result.integrations += 1;
    fetchMain();
  }
  isPushed = true;
  result.commitSha = revision("HEAD");
  verifyPush(result.commitSha);
  return cleanUp(input.workBranch);
}

function finish(error, marker) {
  result.status = "blocked";
  result.reason = error instanceof Stop ? error.reason : "commit_failed";
  result.message = error instanceof Stop ? error.message : "The closeout ended unexpectedly; see the diagnostics.";
  if (error instanceof Stop && error.files) result.files = error.files;
  if (!(error instanceof Stop)) log(String(error));
  if (isPushed || !work) return;
  try {
    restore(marker);
  } catch (restoreError) {
    result.message += " " + restoreError.message;
  }
}

const input = JSON.parse(fs.readFileSync(0, "utf8"));
let marker = "";
try {
  marker = gitPath("pages-closeout-check-pending");
  publish(input, marker);
} catch (error) {
  finish(error, marker);
}
process.stdout.write(JSON.stringify(result));
process.exitCode = result.status === "done" ? 0 : 1;
`;
