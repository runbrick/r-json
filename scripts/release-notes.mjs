import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(rootDirectory, "package.json");
const outputPath = process.env.GITHUB_OUTPUT;

const appVersion = JSON.parse(readFileSync(packageJsonPath, "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appVersion)) {
  throw new Error(`Invalid app version in package.json: ${appVersion}`);
}

const git = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: rootDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const notesFromGitHistory = (version) => {
  const tags = git(["tag", "--list", "v*", "--sort=-v:refname"])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  const currentTag = `v${version}`;
  const previousTag = tags.find((tag) => tag !== currentTag);
  const logArgs = ["log", "--pretty=format:- %s", "--no-merges"];
  if (previousTag) logArgs.push(`${previousTag}..HEAD`);
  const commits = git(logArgs)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^- \d+\.\d+\.\d+$/.test(line));
  if (commits.length === 0) return "";
  return ["### 提交", "", ...commits].join("\n");
};

const previousReleaseTag = (version) => {
  const currentTag = `v${version}`;
  return git(["tag", "--list", "v*", "--sort=-v:refname"])
    .split(/\r?\n/)
    .map((tag) => tag.trim())
    .find((tag) => tag && tag !== currentTag) ?? "";
};

const notesFromGitHub = async (version) => {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return "";

  const payload = {
    tag_name: `v${version}`,
  };
  if (process.env.GITHUB_SHA) {
    payload.target_commitish = process.env.GITHUB_SHA;
  }
  const previousTag = previousReleaseTag(version);
  if (previousTag) payload.previous_tag_name = previousTag;

  const response = await fetch(
    `https://api.github.com/repos/${repository}/releases/generate-notes`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) return "";
  const data = await response.json();
  return String(data.body ?? "").trim();
};

const hasChangeItems = (markdown) =>
  markdown
    .split(/\r?\n/)
    .some((line) => /^\s*[-*]\s+\S/.test(line));

const generated = await notesFromGitHub(appVersion);
const commits = notesFromGitHistory(appVersion);
const parts = [];
if (generated) parts.push(generated);
if (commits && !hasChangeItems(generated)) parts.push(commits);

const body = (parts.join("\n\n") || "此版本没有附带更新说明。").replace(/\r\n/g, "\n").trim();
process.stdout.write(`${body}\n`);

if (outputPath) {
  const delimiter = `NOTES_${Date.now()}`;
  writeFileSync(
    outputPath,
    `body<<${delimiter}\n${body}\n${delimiter}\nversion=${appVersion}\n`,
    { flag: "a" },
  );
}
