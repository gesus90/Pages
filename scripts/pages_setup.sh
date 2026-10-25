#!/usr/bin/env bash
# Pages delivers this file for review. Transfer never starts it.
# Guided setup of the Pages runner in eight phases. Every change is shown first
# and confirmed; a failed phase stops all later ones. sudo is asked for one
# concrete action at a time and its password prompt hides the input.
# The service manager (systemd, supervisord or none) is detected, not assumed;
# "bash pages_setup.sh --service-manager" prints what it finds and changes nothing.
set -euo pipefail

EXIT_STOPPED=10
runner_directory="$HOME/.local/share/pages-runner"
config_directory="$HOME/.config/pages-runner"
tools_directory="$runner_directory/tools"
current_phase=1
saved_terminal=''
runner_temporary=''
execution_temporary=''
unit_temporary=''
service_plan=process
service_plan_reason=''
supervisor_target=''
supervisor_owner=''

__PAGES_SERVICE_MANAGER__

unit_path=/etc/systemd/system/$systemd_unit

# Phase reports for Pages are private terminal sequences, switched on only when
# Pages starts this script; a person who runs it by hand sees plain text.
progress() {
  [[ "${PAGES_SETUP_PROGRESS:-}" == 1 ]] || return 0
  printf '\033]777;pages-setup;phase=%s;state=%s;step=%s\a' "$1" "$2" "${3:-}" >&2
}
phase() { current_phase=$1; printf '\n[%s/8] %s\n' "$1" "$2"; progress "$1" running; }
phase_done() { progress "$current_phase" done; }
fail() { printf '\n%s\n' "$*" >&2; exit 1; }
stop_by_choice() { printf '\n%s\n' "$*"; exit "$EXIT_STOPPED"; }

cleanup() {
  local status=$?
  [[ -z "$saved_terminal" ]] || stty "$saved_terminal" 2>/dev/null || true
  rm -f -- "$runner_temporary" "$execution_temporary" "$unit_temporary"
  if (( status != 0 && status != EXIT_STOPPED )); then progress "$current_phase" failed || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

confirm() {
  local answer
  progress "$current_phase" waiting confirm
  read -r -p "$1 [j/N] " answer || return 1
  progress "$current_phase" running
  [[ "${answer,,}" == j || "${answer,,}" == ja ]]
}

ask() {
  local answer
  progress "$current_phase" waiting input
  read -r -p "$1 " answer || return 1
  progress "$current_phase" running
  printf '%s' "$answer"
}

# One sudo call per action: the password is asked only for this command and its
# time stamp is dropped right after, so no later step can reuse it.
run_sudo() {
  local status=0
  command -v sudo >/dev/null || fail 'sudo fehlt; die Systemänderung kann nicht ausgeführt werden.'
  printf 'sudo (nur für diese Aktion, Passworteingabe verdeckt): %s\n' "$*"
  progress "$current_phase" waiting sudo
  sudo -p '[sudo] Passwort für %p: ' -- "$@" || status=$?
  sudo -k 2>/dev/null || true
  progress "$current_phase" running
  return "$status"
}

node_major() {
  if command -v node >/dev/null; then node -p 'Number(process.versions.node.split(".")[0])'; else printf '0'; fi
}

tool_version() { timeout 15 "$1" --version 2>/dev/null | head -n 1 | cut -c1-80 || true; }

yes_no() { if [[ "$1" == 1 ]]; then printf 'ja'; else printf 'nein'; fi; }

service_label() {
  case $service_manager in
    systemd) printf 'systemd' ;;
    supervisord) printf 'supervisord' ;;
    *) printf 'kein Dienstmanager' ;;
  esac
}

evidence_text() {
  case $service_evidence in
    pid1-systemd) printf 'PID 1 ist systemd, systemctl antwortet' ;;
    run-systemd-system) printf '/run/systemd/system vorhanden, systemctl antwortet' ;;
    pid1-supervisord) printf 'PID 1 ist supervisord' ;;
    supervisorctl-answers) printf 'supervisorctl antwortet' ;;
    supervisorctl-refused) printf 'ein supervisord-Prozess läuft, supervisorctl verweigert diesem Benutzer die Abfrage' ;;
    *) printf 'weder systemd noch supervisord antworten' ;;
  esac
}

# What the manager itself says about the runner; a file on disk never decides this.
show_service_manager() {
  printf 'Dienstmanager: %s (%s).\n' "$(service_label)" "$(evidence_text)"
  if [[ "$service_can_query" != 1 ]]; then
    printf 'Zustand des Runner-Dienstes: vom Dienstmanager nicht abfragbar.\n'
  elif [[ "$service_manager" == none ]]; then
    printf 'Runner-Prozess: %s.\n' "$([[ "$service_active" == 1 ]] && printf 'läuft' || printf 'läuft nicht')"
  else
    printf 'Laut Dienstmanager: registriert %s, Autostart %s, aktiv %s (Zustand: %s).\n' \
      "$(yes_no "$service_registered")" "$(yes_no "$service_enabled")" "$(yes_no "$service_active")" "${service_state:-unbekannt}"
  fi
}

# supervisord starts the runner as a program of its own configuration. The program
# is written into a file the running supervisord includes, and it needs the right user.
choose_supervisor_target() {
  local pattern directory name
  while IFS= read -r pattern; do
    directory=${pattern%/*}
    name=${pattern##*/}
    [[ "$directory" =~ ^/[A-Za-z0-9_./+-]+$ && -d "$directory" ]] || continue
    [[ "$name" =~ ^[A-Za-z0-9_.-]*\*[A-Za-z0-9_.-]*$ ]] || continue
    supervisor_target="$directory/${name/\*/$supervisor_program}"
    return 0
  done < <(supervisor_include_patterns)
  return 1
}

plan_supervisord() {
  command -v supervisorctl >/dev/null || { service_plan_reason='supervisorctl fehlt.'; return 0; }
  [[ -n "$supervisor_config" ]] || { service_plan_reason='Die Konfigurationsdatei des laufenden supervisord ist nicht ermittelbar (weder -c noch eine lesbare Datei unter /etc/supervisor oder /etc).'; return 0; }
  supervisor_owner=$(stat -c %u "/proc/${supervisord_pid:-0}" 2>/dev/null || true)
  if [[ "$supervisor_owner" != 0 && "$supervisor_owner" != "$EUID" ]]; then
    service_plan_reason='supervisord läuft weder als root noch als dieser Benutzer und kann das Programm nicht unter diesem Konto starten.'
    return 0
  fi
  choose_supervisor_target || { service_plan_reason="supervisord liest keine Include-Dateien aus einem vorhandenen Verzeichnis ([include] in $supervisor_config); die Hauptkonfiguration ändert dieses Setup nicht."; return 0; }
  service_plan=supervisord
}

plan_service() {
  service_plan=process
  service_plan_reason=''
  case $service_manager in
    systemd) service_plan=systemd ;;
    supervisord) plan_supervisord ;;
    *) service_plan_reason='Kein Dienstmanager gefunden.' ;;
  esac
}

show_service_plan() {
  case $service_plan in
    systemd) printf 'Geplant für den Dienst: systemd-Unit %s mit Start beim Systemstart und Neustart bei Fehlern.\n' "$systemd_unit" ;;
    supervisord) printf 'Geplant für den Dienst: supervisord-Programm %s in %s (autostart, autorestart); Konfiguration: %s.\n' "$supervisor_program" "$supervisor_target" "$supervisor_config" ;;
    *)
      printf 'Kein Dienst wird registriert: %s\n' "$service_plan_reason"
      printf 'Angeboten wird nur der Dauerbetrieb des Runners als Hintergrundprozess, ohne Start beim Systemstart.\n'
      printf 'Neustarts sind nicht abgedeckt: Nach einem Neustart des Rechners oder Containers und nach einem Absturz startet nichts den Runner wieder.\n'
      ;;
  esac
}

if [[ "${1:-}" == --service-manager ]]; then
  detect_service_manager
  inspect_service
  show_service_manager
  plan_service
  show_service_plan
  report_service
  printf 'service_evidence=%s\nservice_state=%s\nservice_plan=%s\n' "$service_evidence" "$service_state" "$service_plan"
  exit 0
fi

# ---------------------------------------------------------------- 1
phase 1 'Begrüßung und Vorprüfung'
cat <<'TEXT'
Willkommen beim Pages-Runner-Setup.
Dieses Skript richtet auf diesem Rechner den Pages-Runner ein: Voraussetzungen
prüfen, Codex, Claude Code und OpenCode wählen, Git und GitHub prüfen, den Dienst
einrichten (je nach erkanntem Dienstmanager) und mit Pages koppeln.
Jede Änderung wird vorher angezeigt und einzeln bestätigt (Vorgabe: Nein).
Zugangsdaten gibt nur das jeweilige Werkzeug selbst ein; Passwörter bleiben verdeckt.
Abbruch jederzeit mit Strg+C; bereits abgeschlossene Schritte bleiben bestehen.
TEXT
[[ -t 0 && -t 1 ]] || fail 'Interaktives Terminal erforderlich; keine Änderungen.'
[[ $EUID -ne 0 ]] || fail 'Als normaler Benutzer starten; sudo wird bei Bedarf einzeln verwendet.'
[[ -n "${HOME:-}" && -d "$HOME" && -w "$HOME" ]] || fail 'Das Home-Verzeichnis fehlt oder ist nicht beschreibbar.'
[[ "$HOME" =~ ^/[A-Za-z0-9_./-]+$ ]] || fail 'Der Pfad des Home-Verzeichnisses enthält Zeichen, die das Setup nicht unterstützt.'
[[ ! -L "$runner_directory" && ! -L "$config_directory" ]] || fail 'Runner-Verzeichnis darf kein symbolischer Link sein.'
command -v flock >/dev/null || fail 'flock fehlt (Paket util-linux).'
# Locking the home directory itself creates no file and stops a second setup of this account.
exec 9<"$HOME"
flock -n 9 || fail 'Für dieses Konto läuft bereits ein Setup.'
if [[ -e "$runner_directory/runner.mjs" ]]; then
  printf 'Vorhandener Pages-Runner: %s/runner.mjs (wird nur nach Bestätigung ersetzt).\n' "$runner_directory"
fi
phase_done

# ---------------------------------------------------------------- 2
phase 2 'System erkennen und Abhängigkeiten bestätigen'
[[ -r /etc/os-release ]] || fail 'Betriebssystem nicht ermittelbar.'
# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || fail "Nur Ubuntu mit apt wird unterstützt (erkannt: ${ID:-unbekannt}). Keine Änderungen."
command -v apt-get >/dev/null || fail 'apt-get fehlt.'
architecture=$(uname -m)
case "$architecture" in x86_64|aarch64) ;; *) fail "Architektur nicht unterstützt: $architecture" ;; esac
printf 'Ubuntu %s, %s.\n' "${VERSION_ID:-unbekannt}" "$architecture"
detect_service_manager
inspect_service
show_service_manager
plan_service
show_service_plan
packages=()
for package in ca-certificates git openssh-client util-linux; do
  if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed'; then
    packages+=("$package")
  fi
done
if (( $(node_major) < 22 )); then
  candidate=$(apt-cache policy nodejs | awk '/Candidate:/ {print $2}')
  candidate=${candidate#*:}
  [[ "$candidate" =~ ^([0-9]+)\. ]] || fail 'Kein apt-Kandidat für Node.js. Node.js >=22 bereitstellen und erneut starten.'
  (( BASH_REMATCH[1] >= 22 )) || fail 'Ubuntu-apt bietet Node.js <22. Bitte zuerst Node.js >=22 bereitstellen; keine Änderungen.'
  packages+=(nodejs)
fi
command -v npm >/dev/null || packages+=(npm)
if (( ${#packages[@]} == 0 )); then
  printf 'Alle Abhängigkeiten vorhanden: Node.js %s, git, openssh-client.\n' "$(node --version)"
else
  printf 'Es fehlen: %s\n' "${packages[*]}"
  printf 'Geplante Systemänderung: sudo apt-get update; sudo apt-get install --no-install-recommends %s\n' "${packages[*]}"
  confirm 'Diese Abhängigkeiten installieren?' || stop_by_choice 'Ohne die Abhängigkeiten endet das Setup hier; es wurde nichts geändert.'
  run_sudo bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install --no-install-recommends -y -- "$@"' _ "${packages[@]}" \
    || fail 'Die Paketinstallation ist fehlgeschlagen.'
  (( $(node_major) >= 22 )) || fail 'Node.js >=22 ist nach der Installation nicht verfügbar.'
  command -v npm >/dev/null || fail 'npm ist nach der Installation nicht verfügbar.'
fi
phase_done

# ---------------------------------------------------------------- 3
phase 3 'Codex, Claude Code und OpenCode auswählen und installieren'
export PATH="$tools_directory/bin:$PATH"
selected_tools=()
select_tool() {
  local label=$1 binary=$2 package=$3
  if command -v "$binary" >/dev/null; then
    printf '%s vorhanden: %s. Installation und Anmeldung bleiben erhalten.\n' "$label" "$(command -v "$binary")"
    return 0
  fi
  printf '%s fehlt. Bei Auswahl: npm installiert %s unter %s; keine Anmeldung.\n' "$label" "$package" "$tools_directory"
  if confirm "$label installieren?"; then selected_tools+=("$package"); fi
}
select_tool 'Codex' codex '@openai/codex'
select_tool 'Claude Code' claude '@anthropic-ai/claude-code'
select_tool 'OpenCode' opencode 'opencode-ai'
if (( ${#selected_tools[@]} > 0 )); then
  for package in "${selected_tools[@]}"; do
    printf 'Geplant: npm install --global --prefix %q %q\n' "$tools_directory" "$package"
  done
  confirm 'Diese Werkzeuge installieren?' || stop_by_choice 'Die Werkzeugauswahl wurde nicht bestätigt; das Setup endet hier.'
  for package in "${selected_tools[@]}"; do
    npm install --global --prefix "$tools_directory" "$package" || fail "Installation von $package fehlgeschlagen."
  done
else
  printf 'Keine Werkzeug-Installation gewählt.\n'
fi
phase_done

# ---------------------------------------------------------------- 4
phase 4 'Anbindungen konfigurieren und anmelden'
printf 'Die Anmeldung führt das Werkzeug selbst aus; dieses Skript sieht und speichert keine Zugangsdaten.\n'
printf 'Codex: auf diesem Host selbst „codex login --device-auth“ ausführen.\n'
printf 'Claude Code: auf diesem Host selbst „claude auth login“ ausführen.\n'
printf 'OpenCode: auf diesem Host selbst „opencode auth login“ ausführen.\n'
printf 'Pages startet keine CLI-Anmeldung und überträgt keine CLI-Zugangsdaten. Danach in Einstellungen → Agents das Inventar aktualisieren.\n'
printf 'Provider-Schlüssel (zum Beispiel OpenRouter) hinterlegen Sie später in Pages; sie gehen verschlüsselt über den Runner-Kanal.\n'
phase_done

# ---------------------------------------------------------------- 5
phase 5 'Git und GitHub registrieren und verifizieren'
git_name=$(git config --global --get user.name || true)
git_email=$(git config --global --get user.email || true)
if [[ -n "$git_name" && -n "$git_email" ]]; then
  printf 'Git-Identität (für Commits, getrennt vom GitHub-Login): %s <%s>\n' "$git_name" "$git_email"
else
  printf 'Git-Identität fehlt. Sie steht in Commits und ist kein Zugang zu GitHub.\n'
  git_name=$(ask 'Name für Commits:')
  git_email=$(ask 'E-Mail für Commits:')
  [[ -n "$git_name" && "$git_email" =~ ^[^[:space:]@]+@[^[:space:]@]+$ ]] || fail 'Name und gültige E-Mail-Adresse erforderlich.'
  printf 'Geplant: git config --global user.name / user.email\n'
  confirm 'Diese Git-Identität speichern?' || stop_by_choice 'Ohne Git-Identität endet das Setup hier.'
  git config --global user.name "$git_name"
  git config --global user.email "$git_email"
fi
github_key="$config_directory/github_ed25519"
github_known_hosts="$config_directory/github_known_hosts"
github_login() {
  local reply
  reply=$(ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityAgent=none -i "$github_key" -o UserKnownHostsFile="$github_known_hosts" -o GlobalKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes "$@" -T git@github.com 2>&1 || true)
  [[ "$reply" == *'successfully authenticated'* ]] && printf '%s\n' "$reply"
}
github_register() {
  mkdir -p "$HOME/.ssh" "$config_directory" && chmod 700 "$HOME/.ssh" "$config_directory"
  if [[ ! -e "$github_key" ]]; then
    printf 'Geplant: ssh-keygen -t ed25519 ohne Passphrase (für den unbeaufsichtigten Betrieb) nach %s\n' "$github_key"
    confirm 'Schlüssel erzeugen?' || return 1
    ssh-keygen -q -t ed25519 -N '' -C "pages-runner@$(hostname)" -f "$github_key"
  fi
  printf '\nÖffentlicher Schlüssel (bei GitHub unter Settings → SSH keys, oder als Deploy key des Repositories, eintragen):\n'
  cat "$github_key.pub"
  ask 'Weiter mit Enter, sobald der Schlüssel bei GitHub eingetragen ist.' >/dev/null
  if ! ssh-keygen -F github.com -f "$github_known_hosts" >/dev/null 2>&1; then
    printf '\nHostschlüssel von github.com (mit der Veröffentlichung von GitHub vergleichen):\n'
    ssh-keyscan -t ed25519 github.com 2>/dev/null | tee "$hostkey_file" | ssh-keygen -lf -
    confirm 'Stimmt der Fingerabdruck? Dann in known_hosts übernehmen.' || return 1
    cat "$hostkey_file" >> "$github_known_hosts"
    chmod 600 "$github_known_hosts"
  fi
  github_login >/dev/null
}
github_config() {
  grep -qiE '^[[:space:]]*Host[[:space:]]+github\.com' "$HOME/.ssh/config" 2>/dev/null && return 0
  printf 'Geplant: Eintrag für github.com in %s/.ssh/config (IdentityFile %s)\n' "$HOME" "$github_key"
  if confirm 'Eintrag anlegen?'; then
    printf '\n# Pages runner\nHost github.com\n  IdentityFile %s\n  UserKnownHostsFile %s\n  IdentitiesOnly yes\n' "$github_key" "$github_known_hosts" >> "$HOME/.ssh/config"
    chmod 600 "$HOME/.ssh/config"
  fi
}
if github_status=$(github_login); then
  printf 'GitHub-Anmeldung bereits verifiziert: %s\n' "$github_status"
elif confirm 'GitHub jetzt einrichten und prüfen?'; then
  hostkey_file=$(mktemp)
  github_register || { rm -f -- "$hostkey_file"; fail 'GitHub konnte nicht verifiziert werden.'; }
  rm -f -- "$hostkey_file"
  github_config
  github_status=$(github_login) || fail 'GitHub-Anmeldung mit dem Schlüssel nicht verifiziert.'
  printf 'GitHub verifiziert: %s\n' "$github_status"
else
  progress 5 skipped
  printf 'GitHub nicht verifiziert; Agenten können Repositories erst nach einer Anmeldung klonen.\n'
fi
phase_done

# ---------------------------------------------------------------- 6
phase 6 'Verifizieren und Weiter'
printf 'Node.js %s, %s\n' "$(node --version)" "$(git --version)"
for entry in 'Codex:codex' 'Claude Code:claude' 'OpenCode:opencode'; do
  label=${entry%%:*}; binary=${entry#*:}
  if command -v "$binary" >/dev/null; then printf '%s: %s\n' "$label" "$(tool_version "$binary")"; else printf '%s: nicht installiert\n' "$label"; fi
done
printf 'Runner-Code: %s/runner.mjs. Vorhandene Konfiguration und Arbeitsverzeichnisse bleiben erhalten.\n' "$runner_directory"
confirm 'Runner-Code installieren/aktualisieren?' || stop_by_choice 'Ohne Runner-Code endet das Setup hier; Werkzeuge und Git bleiben eingerichtet.'
umask 077
mkdir -p "$runner_directory" "$config_directory"
runner_temporary=$(mktemp "$runner_directory/.runner.XXXXXX")
cat > "$runner_temporary" <<'RUNNER'
__PAGES_RUNNER_TRANSPORT__
RUNNER
execution_temporary=$(mktemp "$runner_directory/.execution.XXXXXX")
cat > "$execution_temporary" <<'EXECUTION'
__PAGES_RUNNER_EXECUTION__
EXECUTION
mv -f -- "$execution_temporary" "$runner_directory/execution.mjs"
cli_temporary=$(mktemp "$runner_directory/.cli.XXXXXX")
cat > "$cli_temporary" <<'CLI'
__PAGES_RUNNER_CLI__
CLI
mv -f -- "$cli_temporary" "$runner_directory/cli.mjs"
pages_temporary=$(mktemp "$runner_directory/.pages.XXXXXX")
cat > "$pages_temporary" <<'PAGES'
__PAGES_RUNNER_PAGES__
PAGES
mv -f -- "$pages_temporary" "$runner_directory/pages.mjs"
opencode_temporary=$(mktemp "$runner_directory/.opencode.XXXXXX")
cat > "$opencode_temporary" <<'OPENCODE'
__PAGES_RUNNER_OPENCODE__
OPENCODE
mv -f -- "$opencode_temporary" "$runner_directory/opencode.mjs"
live_temporary=$(mktemp "$runner_directory/.live.XXXXXX")
cat > "$live_temporary" <<'LIVE'
__PAGES_RUNNER_LIVE__
LIVE
mv -f -- "$live_temporary" "$runner_directory/live.mjs"
schedule_temporary=$(mktemp "$runner_directory/.schedule.XXXXXX")
cat > "$schedule_temporary" <<'SCHEDULE'
__PAGES_RUNNER_SCHEDULE__
SCHEDULE
mv -f -- "$schedule_temporary" "$runner_directory/schedule.mjs"
journal_temporary=$(mktemp "$runner_directory/.journal.XXXXXX")
cat > "$journal_temporary" <<'JOURNAL'
__PAGES_RUNNER_JOURNAL__
JOURNAL
mv -f -- "$journal_temporary" "$runner_directory/journal.mjs"
provider_temporary=$(mktemp "$runner_directory/.provider.XXXXXX")
cat > "$provider_temporary" <<'PROVIDER'
__PAGES_RUNNER_PROVIDER__
PROVIDER
mv -f -- "$provider_temporary" "$runner_directory/provider.mjs"
github_temporary=$(mktemp "$runner_directory/.github.XXXXXX")
cat > "$github_temporary" <<'GITHUB'
__PAGES_RUNNER_GITHUB__
GITHUB
mv -f -- "$github_temporary" "$runner_directory/github.mjs"
if [[ ! -f "$runner_directory/runner.mjs" ]] || ! cmp -s "$runner_temporary" "$runner_directory/runner.mjs"; then
  mv -f -- "$runner_temporary" "$runner_directory/runner.mjs"
fi
runner_version=$(node "$runner_directory/runner.mjs" --version) || fail 'Der installierte Runner startet nicht.'
printf 'Verifiziert: %s\n' "$runner_version"
confirm 'Weiter: Dienst einrichten und mit Pages koppeln?' || stop_by_choice 'Das Setup endet vor der Dienstregistrierung; alles Bisherige bleibt bestehen.'
phase_done

# ---------------------------------------------------------------- 7
phase 7 "Dienst einrichten ($(service_label))"
node_path=$(readlink -f "$(command -v node)")
[[ "$node_path" =~ ^/[A-Za-z0-9_./+-]+$ ]] || fail 'Der Pfad von Node.js enthält Zeichen, die die Dienstdefinition nicht unterstützt.'
user_name=$(id -un)

register_systemd() {
  unit_temporary=$(mktemp)
  cat > "$unit_temporary" <<UNIT
[Unit]
Description=Pages runner (outbound channel to Pages)
After=network-online.target
Wants=network-online.target
# Without pairing data the service stays quiet instead of failing in a loop.
ConditionPathExists=$config_directory/config.json

[Service]
Type=simple
User=$user_name
WorkingDirectory=$HOME
Environment=HOME=$HOME
Environment=PATH=$tools_directory/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$node_path $runner_directory/runner.mjs
Restart=on-failure
RestartSec=5
# Exit status 78 means wrong configuration or a counterpart that is not our Pages.
RestartPreventExitStatus=78

[Install]
WantedBy=multi-user.target
UNIT
  printf 'Dienstdatei %s:\n' "$unit_path"
  cat "$unit_temporary"
  if cmp -s "$unit_temporary" "$unit_path" 2>/dev/null && [[ "$service_registered" == 1 && "$service_enabled" == 1 ]]; then
    printf 'Der Dienst ist laut systemd bereits unverändert registriert und aktiviert.\n'
    return 0
  fi
  printf 'Geplant: Dienstdatei installieren, systemd neu lesen und %s für den Systemstart aktivieren (noch nicht starten).\n' "$systemd_unit"
  confirm 'Dienst registrieren?' || stop_by_choice 'Der Dienst wurde nicht registriert; das Setup endet hier.'
  run_sudo bash -c 'install -m 0644 -o root -g root -- "$1" "$2" && systemctl daemon-reload && systemctl enable -- "$3"' _ "$unit_temporary" "$unit_path" "$systemd_unit" \
    || fail 'Die Dienstregistrierung ist fehlgeschlagen.'
}

register_supervisord() {
  unit_temporary=$(mktemp)
  {
    printf '; Pages runner (outbound channel to Pages)\n'
    printf '[program:%s]\n' "$supervisor_program"
    printf 'command=%s %s/runner.mjs\n' "$node_path" "$runner_directory"
    printf 'directory=%s\n' "$HOME"
    # supervisord can only change the account when it runs as root.
    if [[ "$supervisor_owner" == 0 ]]; then printf 'user=%s\n' "$user_name"; fi
    printf 'environment=HOME="%s",PATH="%s/bin:/usr/local/bin:/usr/bin:/bin"\n' "$HOME" "$tools_directory"
    printf 'autostart=true\n'
    printf '; Restart after every exit except 0 and 78 (wrong configuration or a counterpart that is not our Pages).\n'
    printf 'autorestart=unexpected\n'
    printf 'exitcodes=0,78\n'
    printf 'redirect_stderr=true\n'
  } > "$unit_temporary"
  printf 'Konfigurationsdatei %s (von supervisord %s eingelesen):\n' "$supervisor_target" "$supervisor_config"
  cat "$unit_temporary"
  if cmp -s "$unit_temporary" "$supervisor_target" 2>/dev/null && [[ "$service_registered" == 1 && "$service_enabled" == 1 ]]; then
    printf 'Das Programm ist laut supervisord bereits unverändert registriert.\n'
    return 0
  fi
  printf 'Geplant: Datei installieren, supervisord neu lesen und prüfen, dass er das Programm übernimmt (noch nicht starten).\n'
  confirm 'Programm bei supervisord registrieren?' || stop_by_choice 'Das Programm wurde nicht registriert; das Setup endet hier.'
  # A file that supervisord does not pick up is removed again, so no dead configuration stays behind.
  run_sudo bash -c '
    config=$3
    ctl() { if [ -n "$config" ]; then supervisorctl -c "$config" "$@"; else supervisorctl "$@"; fi; }
    install -m 0644 -o root -g root -- "$1" "$2" || exit 1
    ctl reread || { rm -f -- "$2"; exit 1; }
    if ! ctl avail | awk -v name="$4" "\$1 == name { found = 1 } END { exit !found }"; then
      rm -f -- "$2"
      echo "supervisord übernimmt die Datei nicht." >&2
      exit 1
    fi' _ "$unit_temporary" "$supervisor_target" "$supervisor_config" "$supervisor_program" \
    || fail 'Die Registrierung bei supervisord ist fehlgeschlagen.'
}

accept_process_only() {
  printf 'Es wird kein Dienst registriert: %s\n' "$service_plan_reason"
  printf 'Der Runner läuft danach nur im Dauerbetrieb als Hintergrundprozess (Ausgabe: %s/runner.log), ohne Start beim Systemstart.\n' "$config_directory"
  printf 'Neustarts sind nicht abgedeckt: Nach einem Neustart des Rechners oder Containers und nach einem Absturz startet nichts den Runner wieder.\n'
  confirm 'Den Runner nur im Dauerbetrieb ohne Dienstmanager betreiben?' || stop_by_choice 'Ohne Dienstmanager und ohne Dauerbetrieb endet das Setup hier; der Runner-Code bleibt installiert.'
  progress 7 skipped
}

# The answers of the manager may have changed since phase 2.
inspect_service
case $service_plan in
  systemd) register_systemd ;;
  supervisord) register_supervisord ;;
  *) accept_process_only ;;
esac
if [[ "$service_plan" == systemd ]]; then
  inspect_service
  [[ "$service_registered" == 1 && "$service_enabled" == 1 ]] || fail 'systemd meldet den Dienst nicht als registriert und für den Systemstart aktiviert.'
fi
phase_done

# ---------------------------------------------------------------- 8
phase 8 'Kopplung und Übergabe'
if [[ -e "$config_directory/config.json" ]]; then
  printf 'Es gibt bereits Kopplungsdaten (%s/config.json).\n' "$config_directory"
  confirm 'Vorhandene Kopplungsdaten verwerfen und neu koppeln?' || stop_by_choice 'Die vorhandene Kopplung bleibt unverändert; das Setup endet hier.'
  rm -f -- "$config_directory/config.json"
fi
printf 'Pages liefert Adresse und einmalige Freigabe automatisch; die Eingabe bleibt verdeckt.\n'
# Echo is switched off before Pages is told to answer, so the grant is never displayed.
saved_terminal=$(stty -g)
stty -echo
progress 8 waiting pairing
pairing_endpoint=''
pairing_grant=''
IFS= read -r -t 120 pairing_endpoint || true
IFS= read -r -t 120 pairing_grant || true
stty "$saved_terminal"
saved_terminal=''
progress 8 running
[[ "$pairing_endpoint" =~ ^wss?://[^[:space:]]+/runner/v1/channel/[a-f0-9-]{36}$ && "$pairing_grant" =~ ^[A-Za-z0-9_-]{43}$ ]] \
  || fail 'Pages hat keine gültige Freigabe geliefert (Zeitüberschreitung, Adresse oder Rechte).'
printf '\nPages-Adresse: %s\n' "$pairing_endpoint"
umask 077
mkdir -p "$config_directory"
printf '%s\n%s\n' "$pairing_endpoint" "$pairing_grant" | node -e '
  const fs = require("fs");
  const target = process.argv[1];
  const [endpoint, token] = fs.readFileSync(0, "utf8").split("\n");
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ endpoint, token, sessionId: null, sequence: 0, jobs: [] }), { mode: 0o600, flag: "wx" });
  fs.renameSync(temporary, target);
' "$config_directory/config.json" || fail 'Die Kopplungsdaten konnten nicht gespeichert werden.'
pairing_grant=''
printf 'Kopplungsdaten gespeichert (%s/config.json, nur für Sie lesbar).\n' "$config_directory"

# The runner is not supervised in this plan; it gets its own session so that closing the
# terminal does not end it, and descriptor 9 (the setup lock) is not passed on to it.
start_detached_runner() {
  local log="$config_directory/runner.log"
  command -v setsid >/dev/null || fail 'setsid fehlt (Paket util-linux).'
  if runner_process_running; then
    printf 'Ein Runner-Prozess läuft bereits; er wird nicht erneut gestartet.\n'
    return 0
  fi
  setsid "$node_path" "$runner_directory/runner.mjs" </dev/null >>"$log" 2>&1 9<&- &
  for ((waited = 0; waited < 5; waited++)); do
    if runner_process_running; then return 0; fi
    sleep 1
  done
  return 1
}

start_supervisord_program() {
  run_sudo bash -c '
    config=$1
    ctl() { if [ -n "$config" ]; then supervisorctl -c "$config" "$@"; else supervisorctl "$@"; fi; }
    ctl update || exit 1
    if ! ctl status "$2" | awk "\$2 == \"RUNNING\" || \$2 == \"STARTING\" { found = 1 } END { exit !found }"; then
      ctl start "$2"
    fi' _ "$supervisor_config" "$supervisor_program"
}

show_service_log() {
  case $service_plan in
    systemd) journalctl --no-pager -u "$systemd_unit" -n 15 2>/dev/null || true ;;
    supervisord) supervisor_ctl tail "$supervisor_program" 2>/dev/null | tail -n 15 || true ;;
    *) tail -n 15 -- "$config_directory/runner.log" 2>/dev/null || true ;;
  esac
}

case $service_plan in
  systemd) printf 'Geplant: %s starten.\n' "$systemd_unit"; run_sudo systemctl start -- "$systemd_unit" ;;
  supervisord) printf 'Geplant: supervisord das Programm %s hinzufügen und starten.\n' "$supervisor_program"; start_supervisord_program ;;
  *) printf 'Geplant: Runner als Hintergrundprozess starten (Ausgabe nach %s/runner.log).\n' "$config_directory"; start_detached_runner ;;
esac || fail 'Der Runner konnte nicht gestartet werden.'
printf 'Warte auf die Registrierung des Runners bei Pages …\n'
for ((waited = 0; waited < 45; waited += 3)); do
  if node -e 'process.exit(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).sessionId ? 0 : 1)' "$config_directory/config.json" 2>/dev/null; then
    registered=1
    break
  fi
  inspect_service
  if [[ "$service_can_query" == 1 ]]; then
    case $service_state in failed | inactive | deactivating | FATAL | EXITED | STOPPED | STOPPING | UNKNOWN | unregistered | absent) break ;; esac
  fi
  sleep 3
done
if [[ "${registered:-0}" != 1 ]]; then
  show_service_log
  fail 'Der Runner hat sich nicht bei Pages registriert. Adresse von diesem Rechner aus erreichbar? Protokoll siehe oben.'
fi
inspect_service
if [[ "$service_can_query" == 1 ]]; then
  [[ "$service_active" == 1 ]] || fail 'Der Dienstmanager meldet den Runner nicht als aktiv.'
fi
printf '\nZustand getrennt betrachtet (Angaben des Dienstmanagers, keine Dateien):\n'
printf '  Dienstmanager %s\n' "$(service_label)"
printf '  Installiert   ja (%s)\n' "$runner_version"
if [[ "$service_can_query" == 1 ]]; then
  printf '  Aktiv         %s\n' "$(yes_no "$service_active")"
  printf '  Autostart     %s\n' "$(yes_no "$service_enabled")"
else
  printf '  Aktiv         nicht abfragbar (der Dienstmanager antwortet diesem Benutzer nicht; der Runner hat sich bei Pages gemeldet)\n'
  printf '  Autostart     nicht abfragbar\n'
fi
printf '  Gekoppelt     ja, Registrierung bei Pages erfolgt\n'
printf '  Bereit        wird von Pages bestätigt; erst dann gilt das Setup als abgeschlossen\n'
if [[ "$service_plan" == process ]]; then
  printf '\nHinweis: Es gibt keinen Dienstmanager und keinen Start beim Systemstart. Neustarts sind nicht abgedeckt.\n'
  printf 'Nach einem Neustart oder Absturz von Hand starten: setsid %s %s/runner.mjs >>%s/runner.log 2>&1 &\n' "$node_path" "$runner_directory" "$config_directory"
fi
