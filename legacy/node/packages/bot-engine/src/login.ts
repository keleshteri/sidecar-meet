import * as fs from 'fs';
import * as path from 'path';
import { defaultChromeProfilePath } from './index';

// Skip Chrome's cache/lock artifacts: they're large, unnecessary for auth,
// and lock files can make the copy fail or race with a still-closing Chrome.
const SKIP_NAMES = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'GrShaderCache',
  'ShaderCache',
  'component_crx_cache',
  'SingletonLock',
  'SingletonCookie',
  'SingletonSocket',
  'lockfile',
]);

function main() {
  const sourceProfileDir = process.argv[2];
  if (!sourceProfileDir || !fs.existsSync(sourceProfileDir)) {
    console.error(
      'Usage: npm run login:google --workspace packages/bot-engine -- "<path to a dedicated Chrome profile folder>"\n\n' +
        'That folder must already be signed into the Google account you want the bot to use — ' +
        'sign in first in real, non-automated Chrome (a separate profile, not your everyday one). ' +
        'See docs/phases/phase-1-bot-engine-api.md#authentication for the full steps.',
    );
    process.exit(1);
  }

  // Chrome expects <userDataDir>/Local State (shared, holds the encryption key
  // metadata) sitting next to <userDataDir>/Default/<profile files>. The
  // source path passed in is the profile folder itself (e.g. ".../User
  // Data/Default"), so "Local State" lives one level up, in its parent.
  const userDataRoot = path.dirname(sourceProfileDir);
  const localStateSrc = path.join(userDataRoot, 'Local State');
  if (!fs.existsSync(localStateSrc)) {
    console.error(
      `Could not find "Local State" next to that profile folder (expected at ${localStateSrc}). ` +
        'Make sure the path you passed is a profile folder directly inside a Chrome "User Data" directory ' +
        '(e.g. "...\\User Data\\Default" or "...\\User Data\\Profile 2"), not the "User Data" directory itself ' +
        'or something else.',
    );
    process.exit(1);
  }

  const destDir = defaultChromeProfilePath();
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  console.log(`Copying ${sourceProfileDir}\n  -> ${destDir}\\Default\n(skipping cache/lock files)...`);
  fs.cpSync(sourceProfileDir, path.join(destDir, 'Default'), {
    recursive: true,
    filter: (src) => !SKIP_NAMES.has(path.basename(src)),
  });
  fs.copyFileSync(localStateSrc, path.join(destDir, 'Local State'));

  console.log('Done.');
  console.log('Make sure Chrome is fully closed (check Task Manager for lingering chrome.exe) before starting the bot API — a running Chrome instance locks this profile.');
}

main();
