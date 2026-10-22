# Service manager detection for the Pages runner. Plain sh (dash, bash) and POSIX
# awk: pages_setup.sh and the read-only probe of Pages both embed this file, so
# the script and Pages see the same machine. Nothing here changes it. Expects
# HOME and runner_directory; safe under set -eu and pipefail.
#
#   detect_service_manager  sets service_manager (systemd, supervisord, none) and
#                           service_evidence, the decisive fact in one word
#   inspect_service         asks that manager about the runner and sets
#                           service_can_query, service_registered, service_enabled,
#                           service_active (1 or 0) and service_state
#   report_service          prints these facts as key=value lines
#
# Every answer comes from a query of the manager: systemctl, supervisorctl or the
# process table. A file on disk never decides registration or state.

systemd_unit=pages-runner.service
supervisor_program=pages-runner
service_manager=none
service_evidence=none
service_can_query=0
service_registered=0
service_enabled=0
service_active=0
service_state=
supervisord_pid=
supervisor_config=
supervisor_answer=silent
supervisor_states=

with_timeout() {
  if command -v timeout >/dev/null 2>&1; then timeout 10 "$@"; else "$@"; fi
}

# Whether the text holds the given line, without a pipe.
has_line() {
  case "
$1
" in
    *"
$2
"*) return 0 ;;
  esac
  return 1
}

# The words of a command line, one per line.
process_words() {
  tr '\0' '\n' 2>/dev/null <"/proc/$1/cmdline" || true
}

# Whether the process runs supervisord itself, as a program or as a script of an interpreter.
runs_supervisord() {
  process_words "$1" | awk 'NR <= 2 && /(^|\/)supervisord(\.py)?$/ { found = 1 } END { exit !found }'
}

find_supervisord() {
  local process
  supervisord_pid=
  if runs_supervisord 1; then
    supervisord_pid=1
    return 0
  fi
  for process in /proc/[0-9]*; do
    if runs_supervisord "${process#/proc/}"; then
      supervisord_pid=${process#/proc/}
      return 0
    fi
  done
  return 0
}

# The configuration file supervisord was started with: its -c option, else the two
# absolute places it searches. Its search relative to the working directory is
# not visible to another user, so a start without -c from such a file stays unknown.
find_supervisor_config() {
  local candidate fallback working_directory
  supervisor_config=
  candidate=
  if [ -n "$supervisord_pid" ]; then
    candidate=$(process_words "$supervisord_pid" | awk '
      previous == "-c" || previous == "--configuration" { print; exit }
      /^--configuration=/ { sub(/^--configuration=/, ""); print; exit }
      /^-c./ { sub(/^-c/, ""); print; exit }
      { previous = $0 }') || candidate=
  fi
  case $candidate in
    '')
      for fallback in /etc/supervisor/supervisord.conf /etc/supervisord.conf; do
        if [ -r "$fallback" ]; then
          candidate=$fallback
          break
        fi
      done
      ;;
    /*) ;;
    *)
      working_directory=$(readlink "/proc/$supervisord_pid/cwd" 2>/dev/null) || working_directory=
      if [ -n "$working_directory" ]; then candidate=$working_directory/$candidate; else candidate=; fi
      ;;
  esac
  if [ -n "$candidate" ] && [ -r "$candidate" ]; then supervisor_config=$candidate; fi
  return 0
}

supervisor_ctl() {
  if [ -n "$supervisor_config" ]; then
    with_timeout supervisorctl -c "$supervisor_config" "$@" </dev/null
  else
    with_timeout supervisorctl "$@" </dev/null
  fi
}

# Asks supervisord for all programs. Only a reply made of status lines counts as an
# answer, so a refused connection, a permission error or a timeout is never read as
# "no programs". supervisorctl reports errors on its standard output; its standard
# error carries only interpreter warnings, which must not disturb the reading.
query_supervisor() {
  local reply status
  supervisor_answer=silent
  supervisor_states=
  command -v supervisorctl >/dev/null 2>&1 || return 0
  status=0
  reply=$(supervisor_ctl status 2>/dev/null) || status=$?
  if { [ "$status" = 0 ] || [ "$status" = 3 ]; } && printf '%s\n' "$reply" | awk '
      NF == 0 { next }
      $2 ~ /^(RUNNING|STOPPED|STARTING|BACKOFF|STOPPING|EXITED|FATAL|UNKNOWN)$/ { next }
      { foreign = 1 }
      END { exit foreign }'; then
    supervisor_answer=answered
    supervisor_states=$reply
  elif printf '%s\n' "$reply" | awk 'tolower($0) ~ /permission denied|errno 13/ { found = 1 } END { exit !found }'; then
    supervisor_answer=refused
  fi
  return 0
}

# The patterns of the [include] section, one absolute pattern per line.
supervisor_include_patterns() {
  [ -n "$supervisor_config" ] || return 0
  awk -v here="$(dirname "$supervisor_config")" '
    function emit(text,    position, count, words, index_) {
      sub(/[ \t]+;.*$/, "", text)
      while ((position = index(text, "%(here)s")) > 0)
        text = substr(text, 1, position - 1) here substr(text, position + 8)
      count = split(text, words, /[ \t]+/)
      for (index_ = 1; index_ <= count; index_++)
        if (words[index_] != "") print (words[index_] ~ /^\// ? words[index_] : here "/" words[index_])
    }
    /^[ \t]*[;#]/ { next }
    /^\[/ { inside = ($0 ~ /^\[include\][ \t]*$/); continuing = 0; next }
    !inside { next }
    /^files[ \t]*[=:]/ { value = $0; sub(/^[^=:]*[=:]/, "", value); emit(value); continuing = 1; next }
    continuing && /^[ \t]+[^ \t]/ { emit($0); next }
    { continuing = 0 }' "$supervisor_config"
  return 0
}

# The configuration files supervisord reads: the main file and the files its include patterns match.
supervisor_files() {
  local pattern file
  [ -n "$supervisor_config" ] || return 0
  printf '%s\n' "$supervisor_config"
  supervisor_include_patterns | while IFS= read -r pattern; do
    for file in $pattern; do
      if [ -f "$file" ]; then printf '%s\n' "$file"; fi
    done
  done
  return 0
}

# One option of the runner's [program:] section; supervisord has no query for it.
# Prints the fallback when the section lacks the option and nothing when no file has the section.
supervisor_program_option() {
  local files
  files=$(supervisor_files) || files=
  [ -n "$files" ] || return 0
  # Word splitting is intended: configuration file names hold no blanks.
  set -f
  awk -v section="[program:$supervisor_program]" -v option="$1" -v fallback="$2" '
    FNR == 1 { inside = 0 }
    /^[ \t]*[;#]/ { next }
    /^\[/ {
      line = $0
      sub(/[ \t]+$/, "", line)
      inside = (line == section)
      if (inside && !found) { found = 1; result = fallback }
      next
    }
    inside && tolower($0) ~ ("^" option "[ \t]*[=:]") {
      value = $0
      sub(/^[^=:]*[=:][ \t]*/, "", value)
      sub(/[ \t]+;.*$/, "", value)
      sub(/[ \t]+$/, "", value)
      result = value
    }
    END { if (found) print result }' $files
  set +f
  return 0
}

detect_service_manager() {
  local pid_one state
  service_manager=none
  service_evidence=none
  find_supervisord
  find_supervisor_config
  pid_one=$(cat /proc/1/comm 2>/dev/null) || pid_one=
  if [ "$pid_one" = systemd ] || [ -d /run/systemd/system ]; then
    if command -v systemctl >/dev/null 2>&1; then
      state=$(with_timeout systemctl is-system-running 2>/dev/null) || true
      case $state in
        initializing | starting | running | degraded | maintenance | stopping)
          service_manager=systemd
          if [ "$pid_one" = systemd ]; then service_evidence=pid1-systemd; else service_evidence=run-systemd-system; fi
          return 0
          ;;
      esac
    fi
  fi
  if [ "$supervisord_pid" = 1 ]; then
    service_manager=supervisord
    service_evidence=pid1-supervisord
    return 0
  fi
  if command -v supervisorctl >/dev/null 2>&1; then
    query_supervisor
    if [ "$supervisor_answer" = answered ]; then
      service_manager=supervisord
      service_evidence=supervisorctl-answers
    elif [ "$supervisor_answer" = refused ] && [ -n "$supervisord_pid" ]; then
      service_manager=supervisord
      service_evidence=supervisorctl-refused
    fi
  fi
  return 0
}

inspect_systemd() {
  local properties
  properties=$(with_timeout systemctl show --property=LoadState --property=UnitFileState --property=ActiveState -- "$systemd_unit" 2>/dev/null) || return 0
  [ -n "$properties" ] || return 0
  service_can_query=1
  if has_line "$properties" LoadState=loaded; then service_registered=1; fi
  if has_line "$properties" UnitFileState=enabled; then service_enabled=1; fi
  if has_line "$properties" ActiveState=active; then service_active=1; fi
  service_state=$(printf '%s\n' "$properties" | sed -n 's/^ActiveState=//p')
  return 0
}

inspect_supervisord() {
  local autostart
  query_supervisor
  [ "$supervisor_answer" = answered ] || return 0
  service_can_query=1
  service_state=$(printf '%s\n' "$supervisor_states" | awk -v name="$supervisor_program" '$1 == name && !seen { print $2; seen = 1 }')
  if [ -z "$service_state" ]; then
    service_state=unregistered
    return 0
  fi
  service_registered=1
  if [ "$service_state" = RUNNING ]; then service_active=1; fi
  autostart=$(supervisor_program_option autostart true | tr 'A-Z' 'a-z') || autostart=
  case $autostart in
    true | t | 1 | yes | y | on) service_enabled=1 ;;
  esac
  return 0
}

# Whether the runner of this account runs: a process whose script is the installed runner.
runner_process_running() {
  local process
  for process in /proc/[0-9]*; do
    if process_words "${process#/proc/}" | awk -v target="$runner_directory/runner.mjs" 'NR <= 3 && $0 == target { found = 1 } END { exit !found }'; then
      return 0
    fi
  done
  return 1
}

# Without a service manager nothing registers the runner; the process table is the only query.
inspect_process() {
  [ -d /proc/self ] || return 0
  service_can_query=1
  if runner_process_running; then
    service_active=1
    service_state=running
  else
    service_state=absent
  fi
  return 0
}

inspect_service() {
  service_can_query=0
  service_registered=0
  service_enabled=0
  service_active=0
  service_state=
  case $service_manager in
    systemd) inspect_systemd ;;
    supervisord) inspect_supervisord ;;
    *) inspect_process ;;
  esac
  return 0
}

report_service() {
  printf 'service_manager=%s\n' "$service_manager"
  printf 'service_query=%s\n' "$service_can_query"
  printf 'service_registered=%s\n' "$service_registered"
  printf 'service_enabled=%s\n' "$service_enabled"
  printf 'service_active=%s\n' "$service_active"
  return 0
}
