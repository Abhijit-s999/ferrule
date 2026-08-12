#!/usr/bin/env bash
# Freeze the Python backend into a single self-contained executable, so an
# installed copy of ferrule needs no Python at all.
#
# PyInstaller cannot cross-compile: this produces a binary for the machine it
# runs on. The release workflow therefore runs it once per platform.
#
#   ./scripts/build-backend.sh        -> dist/backend/ferrule-backend[.exe]

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null || { echo "no $PY on PATH" >&2; exit 1; }

# Build inside a throwaway venv so the system Python is never modified — Arch
# and Debian both refuse `pip install` into the system environment (PEP 668).
VENV="$(mktemp -d)/venv"
"$PY" -m venv "$VENV"
# shellcheck disable=SC1091
if [ -f "$VENV/bin/activate" ]; then . "$VENV/bin/activate"; else . "$VENV/Scripts/activate"; fi

python -m pip install --quiet --upgrade pip
python -m pip install --quiet pyinstaller

# --add-data needs a platform-native separator and an absolute SOURCE path.
# Absolute because --specpath makes PyInstaller resolve relative sources
# against the spec directory rather than the project root; native because Git
# Bash reports $PWD as /d/a/... which PyInstaller reads as the nonexistent
# Windows path \d\a\... . `pwd -W` gives D:/a/... instead.
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*)
    SEP=";"
    SRC="$(pwd -W 2>/dev/null || cygpath -m "$PWD")"
    ;;
  *)
    SEP=":"
    SRC="$PWD"
    ;;
esac

rm -rf build dist/backend
pyinstaller \
  --name ferrule-backend \
  --onefile \
  --distpath dist/backend \
  --workpath build/pyinstaller \
  --specpath build \
  --console \
  --hidden-import ferrule.mathtex \
  --add-data "${SRC}/ferrule/static${SEP}ferrule/static" \
  ferrule.py

deactivate
# The UI is the thing most easily left out of a bundle, and its absence only
# shows up as a 404 on "/" while every API route still answers. Fail the build
# here rather than shipping it.
BIN="dist/backend/ferrule-backend"; [ -f "$BIN.exe" ] && BIN="$BIN.exe"
"$BIN" selftest || { echo "backend selftest FAILED" >&2; exit 1; }

echo
echo "built: dist/backend/ferrule-backend*"
ls -la dist/backend/
