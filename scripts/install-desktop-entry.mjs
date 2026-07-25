// Install a freedesktop .desktop entry so the running app gets a real name and
// icon in the GNOME/Ubuntu dock instead of the generic fallback, and so it can
// be pinned and launched without a terminal.
//
// The dock matches a window to a launcher by WM_CLASS; Electron derives that
// from package.json "name", hence StartupWMClass below. Linux/dev-machine
// convenience only — a packaged build would ship this via electron-builder.

import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
const appsDir = path.join(home, ".local/share/applications");
const iconDir = path.join(home, ".local/share/icons/hicolor/128x128/apps");

const wmClass = "octobase"; // must track package.json "name"
const electron = path.join(root, "node_modules/electron/dist/electron");

await mkdir(appsDir, { recursive: true });
await mkdir(iconDir, { recursive: true });
await copyFile(path.join(root, "src/electron/assets/icon.png"), path.join(iconDir, "octobase.png"));

const entry = `[Desktop Entry]
Type=Application
Name=Octobase
Comment=A note-taking app built for your brain
Exec=${electron} ${root}
Path=${root}
Icon=octobase
Terminal=false
Categories=Office;
StartupWMClass=${wmClass}
`;

const entryPath = path.join(appsDir, "octobase.desktop");
await writeFile(entryPath, entry, { mode: 0o644 });

// Best-effort cache refresh; both are no-ops on systems without the tools.
for (const [cmd, args] of [
  ["update-desktop-database", [appsDir]],
  ["gtk-update-icon-cache", ["-f", "-t", path.join(home, ".local/share/icons/hicolor")]],
]) {
  await run(cmd, args).catch(() => {});
}

console.log(`Installed ${entryPath}`);
