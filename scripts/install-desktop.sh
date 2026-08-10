#!/usr/bin/env bash
# Register satprep with the desktop environment so it appears in the
# application launcher like any other installed program.
#
#   ./scripts/install-desktop.sh              install for the current user
#   ./scripts/install-desktop.sh --uninstall  remove it again
#
# Everything is written under $XDG_DATA_HOME (default ~/.local/share), so this
# needs no root and touches nothing outside your own account.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
BIN="$HOME/.local/bin"
APPS="$DATA/applications"
ICONS="$DATA/icons/hicolor"
DESKTOP="$APPS/satprep.desktop"
LAUNCHER="$BIN/satprep"

refresh() {
    command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
    command -v gtk-update-icon-cache  >/dev/null && gtk-update-icon-cache -qtf "$ICONS" 2>/dev/null || true
}

if [[ "${1:-}" == "--uninstall" ]]; then
    rm -f "$DESKTOP" "$LAUNCHER"
    for s in 32 64 128 256 512; do
        rm -f "$ICONS/${s}x${s}/apps/satprep.png"
    done
    rm -f "$ICONS/scalable/apps/satprep.svg"
    refresh
    echo "satprep removed from the launcher."
    exit 0
fi

mkdir -p "$APPS" "$BIN"

# ---- icons -----------------------------------------------------------------
for s in 32 64 128 256 512; do
    src="$REPO/desktop/icon-$s.png"
    [[ $s == 512 ]] && src="$REPO/desktop/icon.png"
    if [[ -f "$src" ]]; then
        mkdir -p "$ICONS/${s}x${s}/apps"
        cp -f "$src" "$ICONS/${s}x${s}/apps/satprep.png"
    fi
done
if [[ -f "$REPO/desktop/icon.svg" ]]; then
    mkdir -p "$ICONS/scalable/apps"
    cp -f "$REPO/desktop/icon.svg" "$ICONS/scalable/apps/satprep.svg"
fi

# ---- launcher --------------------------------------------------------------
# A tiny wrapper rather than putting the command in Exec= directly: launchers
# do not run a shell, so this is the only place that can resolve Electron and
# report a useful error when it is missing.
cat > "$LAUNCHER" <<LAUNCH
#!/usr/bin/env bash
set -euo pipefail
REPO="$REPO"
cd "\$REPO"

if [[ -x "\$REPO/node_modules/.bin/electron" ]]; then
    exec "\$REPO/node_modules/.bin/electron" "\$REPO" "\$@"
elif command -v electron >/dev/null; then
    exec electron "\$REPO" "\$@"
else
    msg="satprep needs its dependencies installed. Run: cd \$REPO && npm install"
    command -v notify-send >/dev/null && notify-send "satprep" "\$msg"
    echo "\$msg" >&2
    exit 1
fi
LAUNCH
chmod +x "$LAUNCHER"

# ---- desktop entry ---------------------------------------------------------
# StartupWMClass lets the compositor match the running window to this entry,
# so the taskbar shows the real icon and name instead of a generic Electron one.
cat > "$DESKTOP" <<ENTRY
[Desktop Entry]
Type=Application
Version=1.0
Name=satprep
GenericName=SAT practice
Comment=Adaptive SAT practice with per-skill analytics and a local AI tutor
Exec=$LAUNCHER %U
Icon=satprep
Terminal=false
Categories=Education;Math;
Keywords=SAT;study;exam;practice;test;college;prep;
StartupNotify=true
StartupWMClass=satprep
ENTRY

refresh

echo "Installed:"
echo "  entry    $DESKTOP"
echo "  launcher $LAUNCHER"
echo "  icons    $ICONS/{32x32,64x64,128x128,256x256,512x512}/apps/satprep.png"
echo
echo "satprep should now appear in your launcher. You can also run: satprep"
