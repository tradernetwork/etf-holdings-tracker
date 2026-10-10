#!/usr/bin/env bash
#
# Write mobile/credentials.json (EAS "local credentials") for the Play UPLOAD key.
#
# The key material lives OUTSIDE the repo:
#   ~/secrets/tickertrace-play/signing.keystore
#   ~/secrets/tickertrace-play/signing-key-info.txt   (the "Key store password:", "Key alias:", "Key password:" lines)
# This script reads the info file and writes credentials.json (mode 600) pointing at the keystore, in
# the format https://docs.expo.dev/app-signing/local-credentials/ documents. It NEVER echoes a value,
# and credentials.json is git-ignored. Only the `preview` build profile uses it (eas.json:
# credentialsSource "local"); production uses EAS-hosted credentials.
#
# Usage:   mobile/scripts/write-local-credentials.sh
# Env:     SECRETS_DIR   default ~/secrets/tickertrace-play
#          OUT           default mobile/credentials.json (next to this script's parent)
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-$HOME/secrets/tickertrace-play}"
INFO="$SECRETS_DIR/signing-key-info.txt"
KEYSTORE="$SECRETS_DIR/signing.keystore"
OUT="${OUT:-$(cd "$(dirname "$0")/.." && pwd)/credentials.json}"

[ -r "$INFO" ] || { echo "error: cannot read $INFO" >&2; exit 1; }
[ -r "$KEYSTORE" ] || { echo "error: cannot read $KEYSTORE" >&2; exit 1; }

# Secrets go through the environment of a single child process (never argv, never stdout).
umask 077
INFO="$INFO" KEYSTORE="$KEYSTORE" OUT="$OUT" python3 - <<'PY'
import json, os, sys

fields = {}
with open(os.environ["INFO"], encoding="utf-8") as fh:
    for line in fh:
        key, sep, value = line.partition(":")
        if sep:
            fields[key.strip().lower()] = value.strip()

def need(name):
    v = fields.get(name, "")
    if not v:
        sys.exit(f"error: '{name}' not found in the key info file")
    return v

creds = {"android": {"keystore": {
    "keystorePath": os.environ["KEYSTORE"],          # absolute path outside the repo
    "keystorePassword": need("key store password"),
    "keyAlias": need("key alias"),
    "keyPassword": need("key password"),
}}}

out = os.environ["OUT"]
fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as fh:
    json.dump(creds, fh, indent=2)
    fh.write("\n")
os.chmod(out, 0o600)
PY

echo "wrote $OUT (mode 600, git-ignored). Run preview builds from this machine; do not commit or share it."
