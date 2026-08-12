'use strict';

/* Ad-hoc sign the macOS app.
 *
 * Without an Apple Developer certificate electron-builder skips signing
 * entirely ("0 valid identities found"). On Apple Silicon that is fatal rather
 * than cosmetic: arm64 refuses to execute a binary with no signature at all,
 * and the user is told the app "is damaged and can't be opened" — which sounds
 * like a corrupt download and sends them to re-download it forever.
 *
 * An ad-hoc signature (`codesign --sign -`) is free, needs no certificate, and
 * is enough for the binary to run. It is NOT notarisation: first launch still
 * needs right-click → Open, or one `xattr` command, both documented in the
 * README. Proper notarisation needs a paid Apple Developer account; if one is
 * ever added, set CSC_LINK / CSC_KEY_PASSWORD and this hook stays out of the
 * way.
 */

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.env.CSC_LINK) return; // a real certificate is configured; leave it alone

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  try {
    execFileSync(
      'codesign',
      ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath],
      { stdio: 'inherit' }
    );
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      stdio: 'inherit',
    });
    console.log(`  • ad-hoc signed ${appName}`);
  } catch (e) {
    // Do not fail the build: an unsigned Intel build still runs, and a broken
    // signature step should not block the other platforms' artifacts.
    console.warn(`  • ad-hoc signing failed (continuing): ${e.message}`);
  }
};
