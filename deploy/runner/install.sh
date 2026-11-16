#!/usr/bin/env bash
# Run by the Pages installation and update under the privileged provisioning account.
set -euo pipefail
instance=${1:-default}
[[ "$instance" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid instance' >&2; exit 1; }
source_directory=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
install -m 0644 -- "$source_directory/pages-runner@.service" /etc/systemd/system/pages-runner@.service
install -d -m 0755 -- "/etc/systemd/system/pages-api@$instance.service.d"
cat > "/etc/systemd/system/pages-api@$instance.service.d/local-runner.conf" <<UNIT
[Service]
ExecStartPre=/usr/bin/env node /opt/pages/scripts/local-runner-setup.mjs /etc/pages/$instance/config.toml /var/lib/pages/$instance/runner/config.json
Environment=PAGES_LOCAL_RUNNER_CONFIG=/var/lib/pages/$instance/runner/config.json
UNIT
install -d -m 0755 -- "/etc/systemd/system/pages-runs@$instance.service.d"
cat > "/etc/systemd/system/pages-runs@$instance.service.d/local-runner.conf" <<UNIT
[Service]
Environment=PAGES_LOCAL_RUNNER_CONFIG=/var/lib/pages/$instance/runner/config.json
UNIT
# A lingering user manager owns per-job cgroups, independently of either transport.
loginctl enable-linger pages
systemctl start "user@$(id -u pages).service"
systemctl daemon-reload
systemctl enable "pages-runner@$instance.service"
systemctl restart "pages-api@$instance.service"
# The authenticated release offer drains work and replaces the local runner itself.
systemctl start "pages-runner@$instance.service"
if systemctl is-active --quiet "pages-runs@$instance.service"; then
  systemctl restart "pages-runs@$instance.service"
fi
