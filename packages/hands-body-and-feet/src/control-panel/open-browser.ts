import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Detect WSL (Linux kernel reports a Microsoft build, or WSL env vars are set). */
function isWsl(): boolean {
  if (process.platform !== 'linux') return false;
  if (process.env['WSL_DISTRO_NAME'] || process.env['WSL_INTEROP']) return true;
  try {
    return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * Open a URL in the user's default browser. Cross-platform, including WSL
 * (which must shell out to the Windows host). Best-effort and non-blocking:
 * never throws and never keeps the process alive.
 */
export function openUrl(url: string): boolean {
  try {
    let command: string;
    let args: string[];
    if (process.platform === 'win32' || isWsl()) {
      // `cmd /c start "" "<url>"` — the empty string is the window title.
      command = 'cmd.exe';
      args = ['/c', 'start', '', url];
    } else if (process.platform === 'darwin') {
      command = 'open';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      /* browser open is best-effort; the caller has already printed the URL */
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
