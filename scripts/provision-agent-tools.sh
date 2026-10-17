#!/usr/bin/env bash
# Separate operator provisioning; the Pages web process never invokes this file.
set -euo pipefail

if [[ $# -gt 1 || (${1:-} != "" && ${1:-} != "--apply") ]]; then
  printf 'Usage: %s [--apply]\nWithout --apply, prints the fixed package plan only.\n' "$0" >&2
  exit 2
fi

if [[ ! -r /etc/os-release ]]; then
  printf 'Unsupported host: provision Node, bubblewrap and browser libraries through your OS administrator.\n' >&2
  exit 2
fi

. /etc/os-release
packages=(bubblewrap ca-certificates fonts-liberation libnss3 libnspr4 libdrm2
  libdbus-1-3 libx11-6 libxcb1 libxkbcommon0 libxcomposite1 libxdamage1 libxext6
  libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libxt6 libx11-xcb1
  libdbus-glib-1-2)

case "${ID:-}:${VERSION_ID:-}" in
  debian:12)
    packages+=(libatk1.0-0 libatk-bridge2.0-0 libcups2 libasound2 libgtk-3-0)
    ;;
  ubuntu:24.04)
    packages+=(libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libasound2t64 libgtk-3-0t64)
    ;;
  *)
    printf 'Unsupported distribution: this reviewed recipe covers Debian 12 and Ubuntu 24.04. No packages changed.\n' >&2
    exit 2
    ;;
esac

printf 'Reviewed host package plan (%s %s):\n' "$ID" "$VERSION_ID"
printf '  %s\n' "${packages[@]}"
printf 'Node.js >=24.0.0 (Pages MCP) and npm must already be provided by the operator.\n'
printf 'This recipe changes no kernel, namespace, AppArmor or container policy.\n'

if [[ ${1:-} != "--apply" ]]; then
  printf 'Review the plan; an authorized operator may rerun with --apply.\n'
  exit 0
fi

if [[ $EUID -ne 0 ]]; then
  printf 'Host package installation requires an authorized privileged setup process. Pages must keep running without root.\n' >&2
  exit 1
fi

/usr/bin/apt-get update
/usr/bin/apt-get install --yes --no-install-recommends "${packages[@]}"
printf 'Run the Tools functionality checks as the unprivileged Pages service account.\n'
