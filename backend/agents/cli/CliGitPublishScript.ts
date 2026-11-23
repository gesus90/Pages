import { quoteCliArgument } from "./CliEnvironment";

/** How often a failed push or remote read is attempted in one publication. */
const PUBLISH_ATTEMPTS = 3;

function branchCheck(originUrl: string): string {
  return `#!/bin/sh
branch=$1
if [ -z "$branch" ] || ! git check-ref-format "refs/heads/$branch"; then
  echo "NOT PUBLISHED: name the target branch, for example: main" >&2
  exit 64
fi
commit=$(git rev-parse --verify 'HEAD^{commit}') || exit 64
target=${quoteCliArgument(originUrl)}
`;
}

/** Accepts origin as the managed address itself or as an SSH host that resolves to GitHub with the same repository. */
function originCheck(repository: string, originUrl: string): string {
  return `# origin only identifies the repository; every transfer below uses the managed address.
origin=$(git remote get-url --push origin | tr '[:upper:]' '[:lower:]')
origin=\${origin%/}
origin=\${origin%.git}
if [ "$origin" != ${quoteCliArgument(originUrl.toLowerCase())} ]; then
  case "$origin" in
    ssh://*) authority=\${origin#ssh://}; alias_path=\${authority#*/}; authority=\${authority%%/*} ;;
    *://*) authority=; alias_path= ;;
    *:*) authority=\${origin%%:*}; alias_path=\${origin#*:} ;;
    *) authority=; alias_path= ;;
  esac
  alias_host=\${authority#*@}
  alias_path=\${alias_path#/}
  resolved=
  case "$alias_host" in
    ''|-*|*[!a-z0-9._-]*) ;;
    *)
      if [ "$alias_path" = ${quoteCliArgument(repository.toLowerCase())} ]; then
        resolved=$(ssh -G -- "$alias_host" 2>/dev/null </dev/null | awk '$1 == "hostname" { print $2; exit }')
      fi ;;
  esac
  case "$resolved" in
    github.com|ssh.github.com)
      echo "Pages: origin uses the SSH host $alias_host of GitHub for ${repository}; publishing over the project connection." >&2 ;;
    *)
      echo "NOT PUBLISHED: origin is not the repository of the project connection (${repository}) or an SSH alias of GitHub for it." >&2
      exit 64 ;;
  esac
fi
`;
}

/** Stops before any transfer when the session may not update the branch at all. */
function approvalCheck(pushRefs: readonly string[] | null): string {
  if (pushRefs === null) return "";
  const allowed = pushRefs.join(" ");
  return `case ${quoteCliArgument(` ${allowed} `)} in
  *" refs/heads/$branch "*) ;;
  *)
    echo ${quoteCliArgument(`NOT PUBLISHED: this session may not update that branch (allowed: ${allowed || "none"}). Your commit and branch are unchanged; do not retry, report this as blocked.`)} >&2
    exit 77 ;;
esac
`;
}

function transferFunctions(): string {
  return `# A stalled transfer must end as a failed attempt instead of holding the session until its timeout.
transfer() {
  LC_ALL=C git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=60 "$@"
}
stop_if_refused() {
  case "$1" in
    *"Authentication failed"*|*"could not read Username"*|*"Invalid username"*|*"Permission to "*|*"Permission denied"*|*"not granted"*|*"Repository not found"*|*"error: 401"*|*"error: 403"*|*"Pages Git bridge refused"*)
      echo "NOT PUBLISHED: this credential was refused. Your commit and branch are unchanged; do not retry, report this as blocked." >&2
      exit 77 ;;
  esac
}
stop_after_attempts() {
  if [ "$attempt" -ge ${PUBLISH_ATTEMPTS} ]; then
    echo "NOT PUBLISHED: $1 after ${PUBLISH_ATTEMPTS} attempts. Your commit and branch are unchanged." >&2
    exit "$2"
  fi
  sleep $((attempt * 5))
  attempt=$((attempt + 1))
}
# Sets remote to the commit of the remote branch, empty when the branch does not exist.
read_remote() {
  attempt=1
  while :; do
    output=$(transfer ls-remote --exit-code "$target" "refs/heads/$branch" 2>&1)
    status=$?
    [ "$status" -eq 0 ] && break
    if [ "$status" -eq 2 ]; then
      remote=
      return
    fi
    printf '%s\\n' "$output" >&2
    stop_if_refused "$output"
    stop_after_attempts "$1" "$2"
  done
  remote=$(printf '%s\\n' "$output" | awk -v ref="refs/heads/$branch" '$2 == ref { print $1 }')
}
`;
}

function publication(repository: string): string {
  const published = `echo "PUBLISHED ${repository} refs/heads/$branch $commit"`;
  return `read_remote "GitHub stayed unreachable" 75
if [ "$remote" = "$commit" ]; then
  echo "Pages: refs/heads/$branch already holds $commit; nothing was pushed." >&2
  ${published}
  exit 0
fi
if [ -n "$remote" ] && ! git merge-base --is-ancestor "$remote" "$commit" 2>/dev/null; then
  echo "NOT PUBLISHED: refs/heads/$branch holds $remote, which HEAD does not contain. Your commit and branch are unchanged; fetch, integrate and run this again." >&2
  exit 78
fi
attempt=1
while ! output=$(transfer push "$target" "$commit:refs/heads/$branch" 2>&1); do
  printf '%s\\n' "$output" >&2
  stop_if_refused "$output"
  case "$output" in
    *"[rejected]"*|*"[remote rejected]"*)
      echo "NOT PUBLISHED: GitHub rejected the update. Your commit and branch are unchanged; fetch, integrate and run this again." >&2
      exit 78 ;;
  esac
  stop_after_attempts "GitHub stayed unreachable" 75
done
printf '%s\\n' "$output" >&2
read_remote "the remote branch could not be read back" 79
if [ -z "$remote" ]; then
  echo "NOT PUBLISHED: the push ended without error, but refs/heads/$branch does not exist on the remote." >&2
  exit 79
fi
if [ "$remote" != "$commit" ]; then
  echo "NOT PUBLISHED: refs/heads/$branch holds $remote instead of $commit." >&2
  exit 79
fi
# The push went to the managed address, so Git did not move the tracking branch of origin itself.
git update-ref "refs/remotes/origin/$branch" "$commit" 2>/dev/null || :
${published}
`;
}

/**
 * The publish command of one session: a fast-forward push whose success is read back from GitHub.
 * @param repository - The validated `owner/name` of the project connection.
 * @param originUrl - The managed address of that repository, without `.git`; every transfer uses it.
 * @param pushRefs - The branches the session may update, or `null` when GitHub alone decides.
 * @returns A POSIX shell script that takes the target branch as its argument.
 * @remarks
 * `origin` must be the managed address or an SSH host whose `ssh -G` hostname
 * is GitHub, with exactly the repository of the connection; otherwise nothing
 * is transferred. The push never goes to `origin` itself, so an alias only
 * identifies the repository and its own key is never used. The remote branch is
 * read first: when it already holds HEAD nothing is pushed, and when HEAD does
 * not contain it the script stops before a push. Only a `PUBLISHED` line means
 * the remote branch was read afterwards and holds HEAD. Only transport failures
 * are retried; an authentication failure or a rejected update ends at once, and
 * no path forces, deletes or changes local work. Exit codes: 64 wrong use or
 * another repository, 75 GitHub unreachable, 77 authentication, permission or a
 * branch without approval, 78 update rejected or branch moved, 79 the remote
 * does not hold HEAD.
 */
export function gitPublishScript(
  repository: string,
  originUrl: string,
  pushRefs: readonly string[] | null = null,
): string {
  return [
    branchCheck(originUrl),
    originCheck(repository, originUrl),
    approvalCheck(pushRefs),
    transferFunctions(),
    publication(repository),
  ].join("");
}
