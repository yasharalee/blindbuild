// Opening the viewer in its own terminal window, and a best-effort OS notification. Never fatal.
import { spawn, spawnSync } from 'node:child_process';

export const hasCommand = (name, platform = process.platform) =>
  spawnSync(platform === 'win32' ? 'where' : 'which', [name], { stdio: 'ignore' }).status === 0;

const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const appleString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// Every argument stays a separate array element: no string joining, so spaces in paths survive.
export function viewerLaunchers(platform, nodePath, cliPath, runDir) {
  const watchArgs = [nodePath, cliPath, 'watch', runDir];
  if (platform === 'win32') {
    return [
      { file: 'wt', args: ['new-tab', '--title', 'blindbuild builder', ...watchArgs] },
      { file: 'cmd', args: ['/c', 'start', 'blindbuild builder', ...watchArgs] },
    ];
  }
  if (platform === 'darwin') {
    const command = watchArgs.map(shQuote).join(' ');
    return [{ file: 'osascript', args: ['-e', `tell application "Terminal" to do script ${appleString(command)}`] }];
  }
  return [{ file: 'x-terminal-emulator', args: ['-e', ...watchArgs] }];
}

// Returns true when a window was started. False means: print `bb watch <id>` instead.
export function openViewer(runDir, { platform = process.platform, spawnFn = spawn, has = hasCommand, nodePath = process.execPath, cliPath } = {}) {
  for (const { file, args } of viewerLaunchers(platform, nodePath, cliPath, runDir)) {
    if (!has(file, platform)) continue;
    try {
      const child = spawnFn(file, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.on?.('error', () => {});
      child.unref?.();
      return true;
    } catch { /* try the next launcher */ }
  }
  return false;
}

const psString = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function notify(title, text, { platform = process.platform, spawnFn = spawn } = {}) {
  try {
    let file;
    let args;
    if (platform === 'win32') {
      const app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe';
      const script = [
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null',
        '$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)',
        '$x = $t.GetElementsByTagName("text")',
        `$x.Item(0).AppendChild($t.CreateTextNode(${psString(title)})) > $null`,
        `$x.Item(1).AppendChild($t.CreateTextNode(${psString(text)})) > $null`,
        `[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(${psString(app)}).Show([Windows.UI.Notifications.ToastNotification]::new($t))`,
      ].join('; ');
      [file, args] = ['powershell', ['-NoProfile', '-NonInteractive', '-Command', script]];
    } else if (platform === 'darwin') {
      [file, args] = ['osascript', ['-e', `display notification ${appleString(text)} with title ${appleString(title)}`]];
    } else {
      [file, args] = ['notify-send', [title, text]];
    }
    const child = spawnFn(file, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on?.('error', () => {});
    child.unref?.();
  } catch { /* notifications are best effort */ }
}
