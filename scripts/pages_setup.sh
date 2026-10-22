#!/usr/bin/env bash
# Pages delivers this file for review. Transfer never starts it.
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }
confirm() {
  local answer
  read -r -p "$1 [j/N] " answer || return 1
  [[ "$answer" == j || "$answer" == J || "$answer" == ja ]]
}

[[ -t 0 ]] || fail 'Interaktives Terminal erforderlich; keine Änderungen.'
[[ $EUID -ne 0 ]] || fail 'Als normaler Benutzer starten; apt verwendet bei Bedarf sudo.'
[[ -r /etc/os-release ]] || fail 'Betriebssystem nicht ermittelbar.'
# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID:-}" == ubuntu ]] || fail 'Nur Ubuntu mit apt wird unterstützt.'
command -v apt-get >/dev/null || fail 'apt-get fehlt.'
architecture=$(uname -m)
case "$architecture" in x86_64|aarch64) ;; *) fail "Architektur nicht unterstützt: $architecture" ;; esac
printf 'Ubuntu %s, %s. Vorhandene Installationen bleiben erhalten.\n' "${VERSION_ID:-unbekannt}" "$architecture"
runner_directory="$HOME/.local/share/pages-runner"
config_directory="$HOME/.config/pages-runner"
tools_directory="$runner_directory/tools"
export PATH="$tools_directory/bin:$PATH"
[[ ! -L "$runner_directory" && ! -L "$config_directory" ]] || fail 'Runner-Verzeichnis darf kein symbolischer Link sein.'
if [[ -e "$runner_directory/runner.mjs" ]]; then
  printf 'Vorhandener Pages-Runner: %s/runner.mjs (wird nur bei geändertem Code ersetzt).\n' "$runner_directory"
fi

printf '\n1  Bestand prüfen und Werkzeuge auswählen\n'
packages=()
for package in ca-certificates git openssh-client; do
  if ! dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -qx 'install ok installed'; then
    packages+=("$package")
  fi
done
selected_tools=()
select_tool() {
  local label=$1 binary=$2 package=$3
  if command -v "$binary" >/dev/null; then
    printf '%s vorhanden: %s. Installation und Anmeldung bleiben erhalten.\n' "$label" "$(command -v "$binary")"
    confirm "$label weiterverwenden? (Nein lässt das Werkzeug ebenfalls unverändert)" || return 0
    return 0
  fi
  printf '%s fehlt. Bei Auswahl: npm installiert %s unter %s; keine Anmeldung.\n' "$label" "$package" "$tools_directory"
  if confirm "$label zusätzlich installieren?"; then
    selected_tools+=("$package")
  fi
}
select_tool 'Codex' codex '@openai/codex'
select_tool 'Claude Code' claude '@anthropic-ai/claude-code'
select_tool 'OpenCode' opencode 'opencode-ai'

should_install_runner=false
printf 'Runner-Code: %s/runner.mjs. Vorhandene Konfiguration und Arbeitsverzeichnisse bleiben erhalten.\n' "$runner_directory"
if confirm 'Runner-Code installieren/aktualisieren?'; then
  should_install_runner=true
fi
if [[ "$should_install_runner" == false && ${#selected_tools[@]} -eq 0 ]]; then
  printf 'Keine Änderungen gewählt.\n'
  exit 0
fi
node_major=0
if command -v node >/dev/null; then node_major=$(node -p 'Number(process.versions.node.split(".")[0])'); fi
if (( node_major < 22 )); then
  candidate=$(apt-cache policy nodejs | awk '/Candidate:/ {print $2}')
  candidate=${candidate#*:}
  [[ "$candidate" =~ ^([0-9]+)\. ]] || fail 'Kein apt-Kandidat für Node.js. Node.js >=22 bereitstellen und erneut starten.'
  (( BASH_REMATCH[1] >= 22 )) || fail 'Ubuntu-apt bietet Node.js <22. Bitte zuerst Node.js >=22 bereitstellen; keine Änderungen.'
  packages+=(nodejs)
fi
if (( ${#selected_tools[@]} > 0 )) && ! command -v npm >/dev/null; then
  packages+=(npm)
fi
printf '\n2  Geplante Änderungen bestätigen\n'
if (( ${#packages[@]} > 0 )); then
  printf 'Systemänderung: sudo apt-get update; sudo apt-get install --no-install-recommends'
  printf ' %s' "${packages[@]}"
  printf '\n'
else
  printf 'Keine apt-Änderungen erforderlich.\n'
fi
for package in "${selected_tools[@]}"; do
  printf 'Zusätzlich installieren: npm install --global --prefix %q %q\n' "$tools_directory" "$package"
done
if [[ "$should_install_runner" == true ]]; then
  printf 'Runner mit Job-Ausführung unter %s installieren/aktualisieren.\n' "$runner_directory"
  printf 'Maschinenkopplung speichert später Runner-Token unter %s (0600).\n' "$config_directory"
fi
printf 'Keine CLI-Anmeldung, keine Provider-API-Keys, keine Änderung an Shell-Profilen oder systemd.\n'
printf 'Bestehende Zugänge, Konfiguration und Arbeitsverzeichnisse nicht überschreiben.\n'
confirm 'Diese Änderungen ausführen?' || fail 'Abgebrochen; keine Änderungen.'
if (( ${#packages[@]} > 0 )); then
  sudo apt-get update
  sudo apt-get install --no-install-recommends "${packages[@]}"
fi
for package in "${selected_tools[@]}"; do
  npm install --global --prefix "$tools_directory" "$package"
done
[[ "$should_install_runner" == true ]] || exit 0
umask 077
mkdir -p "$runner_directory" "$config_directory"
runner_temporary=$(mktemp "$runner_directory/.runner.XXXXXX")
trap 'rm -f -- "$runner_temporary"' EXIT
cat > "$runner_temporary" <<'RUNNER'
__PAGES_RUNNER_TRANSPORT__
RUNNER
execution_temporary=$(mktemp "$runner_directory/.execution.XXXXXX")
cat > "$execution_temporary" <<'EXECUTION'
__PAGES_RUNNER_EXECUTION__
EXECUTION
mv -f -- "$execution_temporary" "$runner_directory/execution.mjs"
if [[ ! -f "$runner_directory/runner.mjs" ]] || ! cmp -s "$runner_temporary" "$runner_directory/runner.mjs"; then
  mv -f -- "$runner_temporary" "$runner_directory/runner.mjs"
fi
printf '\n3  Pages koppeln: Runner mit Job-Ausführung bereit, noch keine Kopplung bestätigt.\n'
printf 'Separat und bewusst starten: node %q/runner.mjs\n' "$runner_directory"
printf 'CLI-Anmeldungen erfolgen später einzeln im jeweiligen CLI. Dieses Skript speichert keine Provider-API-Keys.\n'
printf 'Registrierungsfreigabe und WS/WSS-Adresse vom Pages-Administrator beziehen.\n'
printf 'Arbeitsbereiche werden separat in Pages eingerichtet. Kein Dienst wurde gestartet.\n'
