import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(rootDirectory, "package.json");
const cargoTomlPath = resolve(rootDirectory, "src-tauri", "Cargo.toml");
const cargoLockPath = resolve(rootDirectory, "src-tauri", "Cargo.lock");

const appVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appVersion)) {
  throw new Error(`Invalid app version in package.json: ${appVersion}`);
}

const replaceFirstMatch = (filePath, pattern, replacement, description) => {
  const original = readFileSync(filePath, "utf8");
  const matcher = new RegExp(pattern.source, pattern.flags);
  if (!matcher.test(original)) {
    throw new Error(`Could not find ${description} in ${filePath}`);
  }
  const updated = original.replace(new RegExp(pattern.source, pattern.flags), replacement);
  if (updated !== original) {
    writeFileSync(filePath, updated);
  }
};

replaceFirstMatch(
  cargoTomlPath,
  /^version = "[^"]+"/m,
  `version = "${appVersion}"`,
  "package version",
);
replaceFirstMatch(
  cargoLockPath,
  /(\[\[package\]\]\r?\nname = "r-json"\r?\nversion = ")[^"]+(")/,
  `$1${appVersion}$2`,
  "lockfile package version",
);

const gitPaths = ["src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
try {
  execFileSync("git", ["add", "--", ...gitPaths], {
    cwd: rootDirectory,
    stdio: "inherit",
  });
} catch {
  // npm version still succeeds if this is run outside a git checkout.
}

console.log(`Synced app version ${appVersion} to Cargo.toml and Cargo.lock`);
