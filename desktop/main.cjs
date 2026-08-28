/**
 * Jarvis Electron main process.
 * Spawns system Node sidecars (never ELECTRON_RUN_AS_NODE) and loads localhost:3000.
 */
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  globalShortcut,
  nativeImage,
  dialog,
  safeStorage,
  Notification,
} = require("electron");
const path = require("path");
const { spawnSync } = require("child_process");
const { JarvisCompanion } = require("./companion.cjs");

const JARVIS_ROOT = path.resolve(__dirname, "..");
const SIDECARS = path.join(JARVIS_ROOT, "scripts", "sidecars.sh");
const JARVIS_URL = process.env.JARVIS_URL || "http://127.0.0.1:3000/";
const REMOTE_MODE = !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(JARVIS_URL);
const OMNI_URL = "http://127.0.0.1:20128/";
const JARVIS_BG = "#0a1020";
const LOAD_RETRIES = 8;

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;
let dashWindow = null;
let tray = null;
let sidecarsAttempted = false;
let isQuitting = false;
let loadRetryTimer = null;
let companion = null;

function nodePathEnv() {
  const extras = ["/opt/homebrew/bin", "/usr/local/bin"];
  const current = process.env.PATH || "";
  return {
    ...process.env,
    PATH: `${extras.join(":")}:${current}`,
    JARVIS_ELECTRON: "1",
    JARVIS_OMNIROUTE_MCP: "1",
  };
}

function runSidecars(action) {
  const result = spawnSync("bash", [SIDECARS, action], {
    cwd: JARVIS_ROOT,
    env: nodePathEnv(),
    stdio: "inherit",
    timeout: action === "start" ? 180_000 : 20_000,
  });
  return result.status === 0;
}

function sidecarStatus() {
  const result = spawnSync("bash", [SIDECARS, "status"], {
    cwd: JARVIS_ROOT,
    env: nodePathEnv(),
    encoding: "utf8",
    timeout: 5_000,
  });
  try {
    return JSON.parse(String(result.stdout || "").trim().split("\n").pop());
  } catch {
    return { omni: "unknown", jarvis: "unknown", hermes: "unknown" };
  }
}

function httpReachable(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = spawnSync(
      "curl",
      ["-sf", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "2", url],
      { encoding: "utf8", timeout: 4_000 },
    );
    const code = String(probe.stdout || "").trim();
    if (code === "200" || code === "307") return true;
    spawnSync("sleep", ["1"]);
  }
  return false;
}

function ensureSidecarsRunning() {
  if (REMOTE_MODE) return true;
  const status = sidecarStatus();
  if (status.jarvis === "up" && status.omni === "up" && status.hermes === "up") {
    return true;
  }
  sidecarsAttempted = true;
  return runSidecars("start");
}

function clearLoadRetry() {
  if (loadRetryTimer) {
    clearTimeout(loadRetryTimer);
    loadRetryTimer = null;
  }
}

function scheduleLoadRetry(reason, attempt = 1) {
  if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
  if (attempt > LOAD_RETRIES) {
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Jarvis",
      message: "Não foi possível carregar a interface.",
      detail: `${reason}\nVerifique ~/Library/Caches/jarvis/ e tente novamente.`,
    });
    return;
  }
  clearLoadRetry();
  loadRetryTimer = setTimeout(() => {
    loadRetryTimer = null;
    ensureSidecarsRunning();
    loadJarvisIntoWindow(attempt + 1);
  }, Math.min(1500 * attempt, 8000));
}

function loadJarvisIntoWindow(attempt = 1) {
  if (!mainWindow || mainWindow.isDestroyed() || isQuitting) return;
  if (!httpReachable(JARVIS_URL, attempt === 1 ? 15_000 : 90_000)) {
    scheduleLoadRetry("Jarvis não respondeu em :3000", attempt);
    return;
  }
  mainWindow.loadURL(JARVIS_URL).catch((error) => {
    console.warn("[Jarvis] loadURL failed:", error);
    scheduleLoadRetry(String(error), attempt);
  });
}

function attachMainWindowHandlers() {
  if (!mainWindow) return;

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _desc, validatedURL) => {
    if (isQuitting || validatedURL !== JARVIS_URL) return;
    if (errorCode === -3) return;
    scheduleLoadRetry(`did-fail-load (${errorCode})`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    if (isQuitting || details.reason === "clean-exit") return;
    ensureSidecarsRunning();
    scheduleLoadRetry(`render-process-gone (${details.reason})`);
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return;

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 560,
    title: "Jarvis",
    show: false,
    backgroundColor: JARVIS_BG,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
  });

  attachMainWindowHandlers();
  loadJarvisIntoWindow();

  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "darwin") {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    clearLoadRetry();
    mainWindow = null;
  });
}

function openDashboard() {
  if (dashWindow && !dashWindow.isDestroyed()) {
    dashWindow.show();
    dashWindow.focus();
    return;
  }
  dashWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: "OmniRoute",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  dashWindow.loadURL(OMNI_URL);
  dashWindow.on("closed", () => {
    dashWindow = null;
  });
}

function needsReload() {
  if (!mainWindow || mainWindow.isDestroyed()) return true;
  const url = mainWindow.webContents.getURL();
  return !url.includes("127.0.0.1:3000");
}

function showMain() {
  ensureSidecarsRunning();
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (needsReload()) {
    loadJarvisIntoWindow();
  }
  mainWindow.show();
  mainWindow.focus();
}

function trayIcon() {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGElEQVQ4T2NkYGD4z0ABYBw1gGE0DBgYBgAAvwYB2m3nVwAAAABJRU5ErkJggg==",
    "base64",
  );
  const image = nativeImage.createFromBuffer(png);
  image.setTemplateImage(true);
  return image;
}

function buildTray() {
  if (tray) tray.destroy();
  tray = new Tray(trayIcon());
  tray.setToolTip("Jarvis");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Mostrar Jarvis", click: showMain },
      {
        label: "Uso OmniRoute",
        click: () => {
          showMain();
          mainWindow?.webContents.send("open-usage-panel");
        },
      },
      { label: "Dashboard OmniRoute", click: openDashboard },
      { type: "separator" },
      {
        label: "Sair",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function registerIpc() {
  ipcMain.handle("sidecars-status", () => sidecarStatus());
  ipcMain.handle("companion-status", () => companion?.status() ?? { paired: false, grants: [] });
  ipcMain.handle("companion-pair", (_event, input) =>
    companion?.pair({ baseUrl: input?.baseUrl || JARVIS_URL, code: String(input?.code || "") }),
  );
  ipcMain.handle("companion-add-grant", () => companion?.addGrant());
  ipcMain.handle("companion-upload-file", (_event, workspaceId) =>
    companion?.uploadSelectedFile(String(workspaceId || "jarvis")),
  );
  ipcMain.on("open-omni-dashboard", () => openDashboard());
}

app.on("second-instance", showMain);

app.whenReady().then(() => {
  companion = new JarvisCompanion({
    app,
    safeStorage,
    dialog,
    notify: (title, body) => new Notification({ title, body }).show(),
    showMain,
    onAccess: (active, capability) => {
      tray?.setToolTip(active ? `Jarvis — acessando ${capability}` : "Jarvis");
      mainWindow?.webContents.send("companion-access", { active, capability });
    },
  });
  registerIpc();
  sidecarsAttempted = !REMOTE_MODE;
  const ok = REMOTE_MODE || runSidecars("start");
  if (!ok) {
    dialog.showErrorBox(
      "Jarvis",
      "Não deu para subir OmniRoute + Jarvis. Veja os logs em ~/Library/Caches/jarvis/",
    );
  }
  createMainWindow();
  buildTray();
  companion.start();
  const shortcutOk = globalShortcut.register("CommandOrControl+Shift+J", showMain);
  if (!shortcutOk) {
    console.warn("[Jarvis] atalho Cmd+Shift+J já em uso");
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  clearLoadRetry();
  globalShortcut.unregisterAll();
  companion?.stop();
  if (sidecarsAttempted) runSidecars("stop");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", showMain);
