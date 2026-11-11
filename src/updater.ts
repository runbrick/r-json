import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatVersion(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

export function bindUpdater() {
  const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
  const modal = byId("update-modal");
  const status = byId("update-status");
  const notes = byId("update-notes");
  const progressWrap = byId("update-progress-wrap");
  const progress = byId<HTMLProgressElement>("update-progress");
  const progressLabel = byId("update-progress-label");
  const installButton = byId<HTMLButtonElement>("update-install");
  const backgroundButton = byId<HTMLButtonElement>("update-background");
  const checkButton = byId<HTMLButtonElement>("update-check");
  const closeButton = byId<HTMLButtonElement>("update-modal-close");
  const laterButton = byId<HTMLButtonElement>("update-later");
  const indicator = byId<HTMLButtonElement>("update-indicator");
  const versionBadge = byId("app-version");

  let pendingUpdate: Update | null = null;
  let checking = false;
  let downloading = false;
  let installing = false;
  let downloaded = false;
  let installed = false;
  let background = false;
  let upToDate = false;
  let appVersion = versionBadge.textContent?.replace(/^v/, "") ?? "0.1.0";

  const showModal = () => modal.classList.remove("hidden");
  const closeModal = () => {
    if (installing) return;
    if (downloading) background = true;
    modal.classList.add("hidden");
  };
  const setIndicator = (text: string) => {
    indicator.textContent = text;
    indicator.title = `${text}，点击查看更新详情`;
    indicator.classList.remove("hidden");
  };
  const renderButtons = () => {
    const busy = checking || downloading || installing;
    checkButton.disabled = busy || downloaded || installed;
    installButton.disabled = busy || !pendingUpdate;
    installButton.classList.toggle("hidden", !pendingUpdate);
    installButton.textContent = installed ? "重启应用" : downloaded ? "安装并重启" : "立即更新";
    backgroundButton.classList.toggle("hidden", !pendingUpdate || downloaded || installing || installed);
    backgroundButton.disabled = checking;
    closeButton.disabled = installing;
    laterButton.disabled = installing;
  };
  const renderVersions = () => {
    byId("update-current-version").textContent = formatVersion(appVersion);
    byId("update-latest-version").textContent = pendingUpdate
      ? formatVersion(pendingUpdate.version)
      : upToDate ? formatVersion(appVersion) : "—";
    versionBadge.textContent = formatVersion(appVersion);
  };

  const checkForUpdates = async (userRequested: boolean) => {
    if (userRequested) showModal();
    if (checking || downloading || installing || downloaded || installed) return;
    checking = true;
    renderButtons();
    if (userRequested) {
      status.textContent = "正在检查 GitHub 上的新版本…";
      notes.textContent = "";
      progressWrap.classList.add("hidden");
    }
    try {
      const update = await check();
      if (pendingUpdate) await pendingUpdate.close().catch(() => undefined);
      pendingUpdate = update;
      upToDate = !update;
      renderVersions();
      indicator.classList.add("hidden");
      if (!update) {
        status.textContent = "当前已是最新版本。";
        notes.textContent = "";
        return;
      }
      status.textContent = `发现新版本 ${formatVersion(update.version)}。`;
      notes.textContent = update.body?.trim() || "此版本没有附带更新说明。";
      showModal();
    } catch (error) {
      upToDate = false;
      renderVersions();
      if (userRequested) {
        status.textContent = "检查更新失败。";
        notes.textContent = String(error);
      }
    } finally {
      checking = false;
      renderButtons();
    }
  };

  const installUpdate = async () => {
    if (!pendingUpdate || downloading || installing || checking) return;
    installing = true;
    renderButtons();
    showModal();
    try {
      if (!installed) {
        status.textContent = "正在安装更新，完成后将重启应用…";
        progressLabel.textContent = "正在安装…";
        setIndicator("正在安装更新…");
        await pendingUpdate.install();
        installed = true;
      }
      status.textContent = "更新已安装，即将重启应用。";
      progressLabel.textContent = "安装完成";
      await relaunch();
    } catch (error) {
      status.textContent = installed ? "更新已安装，重启失败，请重试。" : "安装失败，请重试。";
      progressLabel.textContent = String(error);
      setIndicator(installed ? "更新已安装，点击重启" : "更新安装失败，点击查看");
    } finally {
      installing = false;
      renderButtons();
    }
  };

  const startUpdate = async (inBackground: boolean) => {
    if (!pendingUpdate || checking || installing) return;
    if (inBackground) {
      background = true;
      closeModal();
    }
    if (downloading) return;
    if (downloaded || installed) {
      await installUpdate();
      return;
    }
    background = inBackground;
    downloading = true;
    renderButtons();
    progressWrap.classList.remove("hidden");
    progress.removeAttribute("value");
    progressLabel.textContent = "准备下载…";
    status.textContent = `正在下载 ${formatVersion(pendingUpdate.version)}…`;
    setIndicator("更新下载中…");
    let received = 0;
    let contentLength: number | undefined;
    try {
      await pendingUpdate.download((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          received = 0;
          if (contentLength) {
            progress.max = contentLength;
            progress.value = 0;
          }
          progressLabel.textContent = contentLength ? `0 / ${formatBytes(contentLength)}` : "开始下载…";
        } else if (event.event === "Progress") {
          received += event.data.chunkLength;
          if (contentLength) {
            progress.max = contentLength;
            progress.value = received;
            progressLabel.textContent = `${formatBytes(received)} / ${formatBytes(contentLength)}`;
            setIndicator(`更新下载中 ${Math.min(100, Math.floor(received / contentLength * 100))}%`);
          } else {
            progressLabel.textContent = `已下载 ${formatBytes(received)}`;
            setIndicator(`更新下载中 ${formatBytes(received)}`);
          }
        } else {
          progress.max = 1;
          progress.value = 1;
          progressLabel.textContent = "下载完成，正在校验更新包…";
        }
      });
      downloaded = true;
      downloading = false;
      renderButtons();
      if (background) {
        status.textContent = "更新已下载，请保存当前工作后点击“安装并重启”。";
        progressLabel.textContent = "下载完成，等待安装";
        setIndicator("更新已就绪，点击安装");
      } else {
        await installUpdate();
      }
    } catch (error) {
      downloading = false;
      renderButtons();
      status.textContent = "下载更新失败，请重试。";
      progressLabel.textContent = String(error);
      setIndicator("更新下载失败，点击查看");
    }
  };

  byId("check-update").onclick = () => void checkForUpdates(true);
  checkButton.onclick = () => void checkForUpdates(true);
  laterButton.onclick = closeModal;
  closeButton.onclick = closeModal;
  indicator.onclick = showModal;
  installButton.onclick = () => void startUpdate(false);
  backgroundButton.onclick = () => void startUpdate(true);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeModal();
  });

  renderButtons();
  void getVersion().then((version) => {
    appVersion = version;
    renderVersions();
  }).catch(() => renderVersions());
  window.setTimeout(() => void checkForUpdates(false), 2500);
}
