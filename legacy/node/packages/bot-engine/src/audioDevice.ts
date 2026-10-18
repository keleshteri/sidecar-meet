import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Shells out to PowerShell + the AudioDeviceCmdlets module (must already be
 * installed — `Install-Module -Name AudioDeviceCmdlets -Scope CurrentUser`)
 * since Windows exposes no other scriptable way to read/set the default
 * audio device. Uses execFile (argv array, no shell) rather than exec to
 * avoid cmd.exe/PowerShell quoting ever mixing.
 */
async function runPowerShell(script: string): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true },
  );
  return stdout.trim();
}

function escapeForSingleQuotedPowerShellString(value: string): string {
  return value.replace(/'/g, "''");
}

/** Current default *playback* device's AudioDeviceCmdlets ID, or undefined if it can't be read. */
export async function getDefaultPlaybackDeviceId(): Promise<string | undefined> {
  try {
    const id = await runPowerShell(
      "Import-Module AudioDeviceCmdlets; (Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' -and $_.Default }).ID",
    );
    return id || undefined;
  } catch {
    return undefined;
  }
}

/** First playback device whose name contains labelMatch (case-insensitive), or undefined if none/lookup failed. */
export async function findPlaybackDeviceIdByLabel(labelMatch: string): Promise<string | undefined> {
  try {
    const escaped = escapeForSingleQuotedPowerShellString(labelMatch);
    const id = await runPowerShell(
      `Import-Module AudioDeviceCmdlets; (Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' -and $_.Name -like '*${escaped}*' } | Select-Object -First 1).ID`,
    );
    return id || undefined;
  } catch {
    return undefined;
  }
}

/** Sets the default playback device (both Default and DefaultCommunication roles) by AudioDeviceCmdlets ID. */
export async function setDefaultPlaybackDeviceId(id: string): Promise<void> {
  const escaped = escapeForSingleQuotedPowerShellString(id);
  await runPowerShell(`Import-Module AudioDeviceCmdlets; Set-AudioDevice -ID '${escaped}' | Out-Null`);
}
