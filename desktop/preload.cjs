const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_INVOKE = new Set(["sidecars-status"]);
const ALLOWED_SEND = new Set(["open-omni-dashboard"]);

contextBridge.exposeInMainWorld("jarvisDesktop", {
  getSidecarStatus: () => {
    if (!ALLOWED_INVOKE.has("sidecars-status")) return Promise.resolve(null);
    return ipcRenderer.invoke("sidecars-status");
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
