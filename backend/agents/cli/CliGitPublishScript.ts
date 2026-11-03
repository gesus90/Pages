import { quoteCliArgument } from "./CliEnvironment";

/** How often a failed push or remote read is attempted in one publication. */
const PUBLISH_ATTEMPTS = 3;

/**
 * The publish command of one session: a fast-forward push whose success is read back from GitHub.
 *
 * @param repository - The validated `owner/name` of the project connection.
 * @param originUrl - The address Git must resolve `origin` to, without `.git`.
 * @returns A POSIX shell script that takes the target branch as its argument.
 *
 * @remarks
 * Only a `PUBLISHED` line means the remote branch was read afterwards and holds
 * HEAD. Pushing what the remote already holds succeeds again, so a repeated run
 * is harmless. Only transport failures are retried, for the push and the read
 * back alike; an authentication failure or a rejected update ends at once, and
 * no path forces, deletes or changes local work. Exit codes: 64 wrong use, 75
 * GitHub unreachable, 77 authentication or permission, 78 update rejected, 79
 * the remote does not hold HEAD.
 */
export function gitPublishScript(
  repository: string,
  originUrl: string,
): string {
  return `#!/bin/sh
branch=$1
if [ -z "$branch" ] || ! git check-ref-format "refs/heads/$branch"; then
  echo "NOT PUBLISHED: name the target branch, for example: main" >&2
  exit 64
fi
commit=$(git rev-parse --verify 'HEAD^{commit}') || exit 64
origin=$(git remote get-url --push origin | tr '[:upper:]' '[:lower:]')
origin=\${origin%/}
origin=\${origin%.git}
if [ "$origin" != ${quoteCliArgument(originUrl.toLowerCase())} ]; then
  echo "NOT PUBLISHED: origin is not the repository of the project connection (${repository})." >&2
  exit 64
fi
# A stalled transfer must end as a failed attempt instead of holding the session until its timeout.
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
attempt=1
while ! output=$(transfer push origin "$commit:refs/heads/$branch" 2>&1); do
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
attempt=1
while :; do
  output=$(transfer ls-remote --exit-code origin "refs/heads/$branch" 2>&1)
  status=$?
  [ "$status" -eq 0 ] && break
  if [ "$status" -eq 2 ]; then
    echo "NOT PUBLISHED: the push ended without error, but refs/heads/$branch does not exist on the remote." >&2
    exit 79
  fi
  printf '%s\\n' "$output" >&2
  stop_if_refused "$output"
  stop_after_attempts "the remote branch could not be read back" 79
done
remote=$(printf '%s\\n' "$output" | awk -v ref="refs/heads/$branch" '$2 == ref { print $1 }')
if [ "$remote" != "$commit" ]; then
  echo "NOT PUBLISHED: refs/heads/$branch holds \${remote:-nothing} instead of $commit." >&2
  exit 79
fi
echo "PUBLISHED ${repository} refs/heads/$branch $commit"
`;
}
