import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = ts.transpileModule(readFileSync(new URL("../src/updater.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function setup({ version = Promise.resolve("0.2.9"), result = null } = {}) {
  const elements = new Map();
  for (const match of html.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
    const classes = new Set(/class="([^"]*)"/.exec(match[0])?.[1].split(/\s+/) ?? []);
    elements.set(match[1], {
      textContent: match[1] === "app-version" ? "v0.1.0" : "",
      disabled: false,
      classList: {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
      },
      removeAttribute(name) { delete this[name]; },
    });
  }
  const download = deferred();
  let onProgress;
  let checks = 0, downloads = 0, installs = 0, restarts = 0, closes = 0;
  let checkResult = result;
  let installError, restartError;
  let installation = Promise.resolve();
  const update = {
    version: "0.3.0", body: "更新说明",
    download: (callback) => { downloads++; onProgress = callback; return download.promise; },
    install: async () => { installs++; if (installError) throw installError; await installation; },
    close: async () => { closes++; },
  };
  const listeners = new Map();
  let timer;
  const exports = {};
  runInNewContext(source, {
    exports,
    require: (name) => {
      if (name === "@tauri-apps/api/app") return { getVersion: () => version };
      if (name === "@tauri-apps/plugin-updater") return { check: async () => { checks++; return await checkResult; } };
      if (name === "@tauri-apps/plugin-process") return { relaunch: async () => { restarts++; if (restartError) throw restartError; } };
      throw new Error(`Unexpected import: ${name}`);
    },
    document: { getElementById: (id) => { assert.ok(elements.has(id), `Missing element ${id}`); return elements.get(id); } },
    window: {
      setTimeout: (callback) => { timer = callback; },
      addEventListener: (event, callback) => listeners.set(event, callback),
    },
  });
  exports.bindUpdater();
  const el = (id) => elements.get(id);
  return {
    el, update, download,
    click: (id) => { assert.equal(el(id).disabled, false, `${id} is disabled`); el(id).onclick(); },
    hidden: (id) => el(id).classList.contains("hidden"),
    counts: () => ({ checks, downloads, installs, restarts, closes }),
    result: (value) => { checkResult = value; },
    progress: (event) => onProgress(event),
    escape: () => listeners.get("keydown")({ key: "Escape" }),
    autoCheck: () => timer(),
    installError: (error) => { installError = error; },
    waitForInstallation: (promise) => { installation = promise; },
    restartError: (error) => { restartError = error; },
  };
}

async function available() {
  const app = setup();
  app.result(app.update);
  await flush();
  app.click("check-update");
  await flush();
  return app;
}

test("an up-to-date result displays the current version in both labels", async () => {
  const app = setup();
  await flush();
  app.click("check-update");
  await flush();
  assert.equal(app.el("update-current-version").textContent, "v0.2.9");
  assert.equal(app.el("update-latest-version").textContent, "v0.2.9");
  assert.equal(app.hidden("update-install"), true);
  assert.equal(app.hidden("update-background"), true);
});

test("a delayed app version response preserves the discovered latest version", async () => {
  const version = deferred();
  const app = setup({ version: version.promise });
  app.result(app.update);
  app.autoCheck();
  await flush();
  version.resolve("0.2.9");
  await flush();
  assert.equal(app.el("update-latest-version").textContent, "v0.3.0");
});

test("background download hides the modal, keeps progress, and waits for explicit installation", async () => {
  const app = await available();
  app.click("update-background");
  assert.equal(app.hidden("update-modal"), true);
  assert.equal(app.hidden("update-indicator"), false);
  app.progress({ event: "Started", data: { contentLength: 100 } });
  app.progress({ event: "Progress", data: { chunkLength: 40 } });
  assert.match(app.el("update-indicator").textContent, /40%/);
  app.click("check-update");
  assert.equal(app.hidden("update-modal"), false);
  assert.equal(app.el("update-progress").value, 40);
  assert.equal(app.counts().checks, 1);
  app.click("update-background");
  assert.equal(app.counts().downloads, 1);
  app.progress({ event: "Finished" });
  app.download.resolve();
  await flush();
  assert.equal(app.hidden("update-modal"), true);
  assert.equal(app.counts().installs, 0);
  assert.equal(app.counts().restarts, 0);
  assert.equal(app.el("update-install").textContent, "安装并重启");
  app.click("update-indicator");
  app.click("update-install");
  await flush();
  assert.equal(app.counts().installs, 1);
  assert.equal(app.counts().restarts, 1);
  assert.equal(app.counts().downloads, 1);
});

test("foreground update downloads, installs, and relaunches", async () => {
  const app = await available();
  app.click("update-install");
  assert.equal(app.hidden("update-modal"), false);
  app.download.resolve();
  await flush();
  assert.equal(app.counts().installs, 1);
  assert.equal(app.counts().restarts, 1);
});

for (const action of ["update-background", "update-later", "update-modal-close", "Escape"]) {
  test(`foreground download can move to background via ${action}`, async () => {
    const app = await available();
    app.click("update-install");
    if (action === "Escape") app.escape(); else app.click(action);
    assert.equal(app.hidden("update-modal"), true);
    app.download.resolve();
    await flush();
    assert.equal(app.counts().installs, 0);
    assert.equal(app.hidden("update-modal"), true);
  });
}

test("unknown download size still reports bytes and finishes with a full progress bar", async () => {
  const app = await available();
  app.click("update-background");
  app.progress({ event: "Started", data: {} });
  app.progress({ event: "Progress", data: { chunkLength: 2048 } });
  assert.match(app.el("update-indicator").textContent, /2.0 KB/);
  app.progress({ event: "Finished" });
  assert.equal(app.el("update-progress").value, app.el("update-progress").max);
  app.download.resolve();
  await flush();
  assert.equal(app.counts().installs, 0);
});

test("background download failures stay nonmodal and allow retry", async () => {
  const app = await available();
  app.click("update-background");
  app.download.reject(new Error("network unavailable"));
  await flush();
  assert.equal(app.hidden("update-modal"), true);
  assert.match(app.el("update-indicator").textContent, /失败/);
  app.click("update-indicator");
  assert.match(app.el("update-progress-label").textContent, /network unavailable/);
  assert.equal(app.el("update-install").disabled, false);
  app.click("update-background");
  await flush();
  assert.equal(app.counts().downloads, 2);
});

test("failed update checks do not claim that the current version is latest", async () => {
  const app = setup();
  await flush();
  app.click("check-update");
  await flush();
  const failure = deferred();
  app.result(failure.promise);
  app.click("update-check");
  failure.reject(new Error("check failed"));
  await flush();
  assert.equal(app.el("update-latest-version").textContent, "—");
  assert.match(app.el("update-status").textContent, /失败/);
});

test("a relaunch failure can retry relaunch without reinstalling", async () => {
  const app = await available();
  app.restartError(new Error("relaunch failed"));
  app.click("update-install");
  app.download.resolve();
  await flush();
  assert.equal(app.el("update-install").textContent, "重启应用");
  app.restartError(undefined);
  app.click("update-install");
  await flush();
  assert.equal(app.counts().installs, 1);
  assert.equal(app.counts().restarts, 2);
});

test("installation failure allows retrying the downloaded package", async () => {
  const app = await available();
  app.installError(new Error("installer failed"));
  app.click("update-install");
  app.download.resolve();
  await flush();
  assert.match(app.el("update-status").textContent, /安装失败/);
  assert.equal(app.el("update-install").disabled, false);
  app.installError(undefined);
  app.click("update-install");
  await flush();
  assert.equal(app.counts().downloads, 1);
  assert.equal(app.counts().installs, 2);
  assert.equal(app.counts().restarts, 1);
});

test("installation blocks duplicate actions and Escape until it completes", async () => {
  const app = await available();
  const installing = deferred();
  app.waitForInstallation(installing.promise);
  app.click("update-install");
  app.download.resolve();
  await flush();
  app.escape();
  assert.equal(app.hidden("update-modal"), false);
  assert.equal(app.el("update-install").disabled, true);
  assert.equal(app.el("update-modal-close").disabled, true);
  app.el("update-install").onclick();
  app.click("check-update");
  assert.equal(app.counts().installs, 1);
  assert.equal(app.counts().checks, 1);
  installing.resolve();
  await flush();
  assert.equal(app.counts().restarts, 1);
});
