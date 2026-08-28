const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_INVOKE = new Set([
  "sidecars-status",
  "companion-status",
  "companion-pair",
  "companion-add-grant",
  "companion-upload-file",
]);
const ALLOWED_SEND = new Set(["open-omni-dashboard"]);

contextBridge.exposeInMainWorld("jarvisDesktop", {
  getSidecarStatus: () => {
    if (!ALLOWED_INVOKE.has("sidecars-status")) return Promise.resolve(null);
    return ipcRenderer.invoke("sidecars-status");
  },
  getCompanionStatus: () => ipcRenderer.invoke("companion-status"),
  pairCompanion: (input) => ipcRenderer.invoke("companion-pair", input),
  addCompanionGrant: () => ipcRenderer.invoke("companion-add-grant"),
  uploadCompanionFile: (workspaceId) => ipcRenderer.invoke("companion-upload-file", workspaceId),
  onCompanionAccess: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("companion-access", listener);
    return () => ipcRenderer.removeListener("companion-access", listener);
  },
  openOmniDashboard: () => {
    if (!ALLOWED_SEND.has("open-omni-dashboard")) return;
    ipcRenderer.send("open-omni-dashboard");
  },
  onOpenUsagePanel: (callback) => {
    if (typeof callback !== "function") return () => {};
    const listener = () => callback();
    ipcRenderer.on("open-usage-panel", listener);
    return () => ipcRenderer.removeListener("open-usage-panel", listener);
  },
});
