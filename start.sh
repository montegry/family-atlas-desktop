#!/bin/sh
set -eu
cd "$(dirname "$0")"
exec ./src-tauri/target/release/family-atlas-desktop "$@"
