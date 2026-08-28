export interface JarvisSidecarStatus {
  omni: "up" | "down" | "unknown";
  jarvis: "up" | "down" | "unknown";
}

export interface JarvisDesktopApi {
  getSidecarStatus: () => Promise<JarvisSidecarStatus | null>;
  openOmniDashboard: () => void;
  onOpenUsagePanel: (callback: () => void) => () => void;
  getCompanionStatus: () => Promise<{ paired: boolean; deviceId: string | null; grants: Array<{ grantId: string; label: string; access: string }> }>;
  pairCompanion: (input: { baseUrl: string; code: string }) => Promise<unknown>;
  addCompanionGrant: () => Promise<unknown>;
  uploadCompanionFile: (workspaceId: string) => Promise<unknown>;
  onCompanionAccess: (callback: (value: { active: boolean; capability: string }) => void) => () => void;
}

declare global {
  interface Window {
    jarvisDesktop?: JarvisDesktopApi;
  }
}

export {};
