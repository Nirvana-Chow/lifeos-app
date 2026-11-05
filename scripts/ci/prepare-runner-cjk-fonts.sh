#!/usr/bin/env bash
set -euo pipefail

# Bound the entire preparation, including cache I/O and package readback. curl's
# retry-max-time alone does not stop an already-started transfer or Retry-After.
if [[ "${1:-}" != --within-deadline ]]; then
  exec timeout --kill-after=5s 180s bash "$0" --within-deadline
fi

readonly version='1:20230817+repack1-3'
readonly filename='fonts-noto-cjk_20230817+repack1-3_all.deb'
# Ubuntu noble's exact package, not a floating latest download:
# https://packages.ubuntu.com/noble/all/fonts-noto-cjk/download
readonly sha256='7d64b985f6fe128c99eae5610d5c047338e572bdcfb2bb09736be01b824a7f6c'
readonly url="https://archive.ubuntu.com/ubuntu/pool/main/f/fonts-noto-cjk/$filename"

installed_package() {
  [[ "$(dpkg-query -W -f='${db:Status-Status} ${Version}\n' fonts-noto-cjk 2>/dev/null)" == "installed $version" ]]
}
if installed_package; then
  echo "Reusing installed fonts-noto-cjk $version; workflow still verifies copyright and Chinese font selection."
  exit 0
fi

readonly cache="${LIFEOS_CJK_FONT_CACHE_DIR:-${RUNNER_TEMP:?}/lifeos-cjk-font-cache}"
scratch="$(mktemp -d "${RUNNER_TEMP:?}/lifeos-cjk-font.XXXXXX")"
readonly scratch
trap 'rm -rf -- "$scratch"' EXIT
readonly package="$scratch/$filename"
if [[ -f "$cache/$filename" ]]; then
  echo 'Checking cached fixed Ubuntu CJK font package.'
  # Install a private snapshot, so a cache path is never passed to root/dpkg.
  cp -- "$cache/$filename" "$package"
else
  echo 'Downloading fixed Ubuntu CJK font package over HTTPS (at most two attempts).'
  curl --fail --location --proto '=https' --proto-redir '=https' \
    --connect-timeout 10 --max-time 65 --speed-limit 1024 --speed-time 20 \
    --retry 1 --retry-delay 2 --retry-max-time 135 \
    --silent --show-error --output "$package" "$url"
fi

# Every cache hit and download must pass the same pinned hash before dpkg-deb or
# privileged execution. A poisoned/partial cache fails closed without installation.
if ! printf '%s  %s\n' "$sha256" "$package" | sha256sum --check --status; then
  echo 'Font package SHA256 mismatch; refusing installation.' >&2
  exit 1
fi
if [[ "$(dpkg-deb --field "$package" Package Version Architecture)" != "$(printf 'Package: fonts-noto-cjk\nVersion: %s\nArchitecture: all' "$version")" ]]; then
  echo 'Unexpected font package identity; refusing installation.' >&2
  exit 1
fi
mkdir -p -- "$cache"
cp -- "$package" "$cache/$filename"
# Keep the privileged child independently bounded, even if the outer user-owned
# timeout cannot signal sudo's root process. Never contact configured APT sources.
sudo -n timeout --kill-after=5s 35s dpkg --install "$package"
installed_package
echo "Prepared fonts-noto-cjk $version from the verified fixed package."
