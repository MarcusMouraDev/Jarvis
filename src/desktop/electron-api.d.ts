export interface JarvisSidecarStatus {
  omni: "up" | "down" | "unknown";
  jarvis: "up" | "down" | "unknown";
}

export interface JarvisDesktopApi {
  getSidecarStatus: () => Promise<JarvisSidecarStatus | null>;
  openOmniDashboard: () => void;
  onOpenUsagePanel: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    jarvisDesktop?: JarvisDesktopApi;
  }
}

export {};
