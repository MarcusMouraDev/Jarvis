const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function insideGrant(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new Error("grant_path_escape");
  }
  const segments = relativePath.replaceAll("\\", "/").split("/");
  if (segments.some((part) => !part || part === "." || part === "..")) {
    throw new Error("grant_path_escape");
  }
  const canonicalRoot = fs.realpathSync(root);
  let target = canonicalRoot;
  for (const part of segments) {
    target = path.join(target, part);
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error("grant_symlink_rejected");
  }
  const canonical = fs.realpathSync(target);
  if (canonical !== canonicalRoot && !canonical.startsWith(`${canonicalRoot}${path.sep}`)) {
    throw new Error("grant_path_escape");
  }
  return canonical;
}

class JarvisCompanion {
  constructor({ app, safeStorage, dialog, notify, onAccess, showMain }) {
    this.app = app;
    this.safeStorage = safeStorage;
    this.dialog = dialog;
    this.notify = notify;
    this.onAccess = onAccess;
    this.showMain = showMain;
    this.timer = null;
    this.running = false;
    this.polling = false;
    this.retryDelayMs = 1_000;
    this.configPath = path.join(app.getPath("userData"), "companion.enc");
    this.config = this.load();
  }

  load() {
    try {
      if (!this.safeStorage.isEncryptionAvailable() || !fs.existsSync(this.configPath)) return {};
      return JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.configPath)));
    } catch {
      return {};
    }
  }

  save() {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("keychain_unavailable");
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    const temporary = `${this.configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, this.safeStorage.encryptString(JSON.stringify(this.config)), {
      mode: 0o600,
    });
    fs.renameSync(temporary, this.configPath);
  }

  status() {
    return {
      paired: Boolean(this.config.token && this.config.baseUrl),
      deviceId: this.config.deviceId || null,
      grants: Object.values(this.config.grants || {}).map(({ grantId, label, access }) => ({
        grantId,
        label,
        access,
      })),
    };
  }

  async pair({ baseUrl, code }) {
    const target = new URL(baseUrl);
    if (target.protocol !== "https:" && target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
      throw new Error("companion_https_required");
    }
    const response = await fetch(new URL("/api/devices/pair", target), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "redeem",
        code,
        label: this.app.getName(),
        capabilities: ["files.list", "files.read", "files.upload", "desktop_ui", "notifications"],
      }),
    });
    if (!response.ok) throw new Error(`companion_pair_${response.status}`);
    const body = await response.json();
    this.config = {
      baseUrl: target.origin,
      token: body.token,
      deviceId: body.device.deviceId,
      grants: this.config.grants || {},
    };
    this.save();
    this.start();
    return this.status();
  }

  async addGrant() {
    if (!this.config.token) throw new Error("companion_not_paired");
    const selection = await this.dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    if (selection.canceled || selection.filePaths.length !== 1) return this.status();
    const root = fs.realpathSync(selection.filePaths[0]);
    const grantId = crypto.randomUUID();
    const grant = { grantId, label: path.basename(root), access: "read", root };
    const response = await this.request("/api/devices/grants", {
      method: "POST",
      body: JSON.stringify({ grantId, label: grant.label, access: grant.access }),
    });
    if (!response.ok) throw new Error(`companion_grant_${response.status}`);
    this.config.grants = { ...(this.config.grants || {}), [grantId]: grant };
    this.save();
    return this.status();
  }

  async uploadSelectedFile(workspaceId = "jarvis") {
    if (!this.config.token) throw new Error("companion_not_paired");
    const selection = await this.dialog.showOpenDialog({ properties: ["openFile"] });
    if (selection.canceled || selection.filePaths.length !== 1) return null;
    this.onAccess(true, "files.upload");
    try {
      return await this.uploadFile(fs.realpathSync(selection.filePaths[0]), { workspaceId });
    } finally {
      this.onAccess(false, "files.upload");
    }
  }

  request(pathname, init = {}) {
    return fetch(new URL(pathname, this.config.baseUrl), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.config.token}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  }

  async uploadFile(target, payload) {
    const content = fs.readFileSync(target);
    const sha256 = crypto.createHash("sha256").update(content).digest("hex");
    const workspaceId = String(payload.workspaceId || "jarvis");
    const fileName = path.basename(target);
    const created = await this.request(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/uploads`,
      {
        method: "POST",
        body: JSON.stringify({
          fileName,
          relativePath: `Inbox/${fileName}`,
          mime: "application/octet-stream",
          size: content.length,
          sha256,
          origin: "mac",
        }),
      },
    );
    if (!created.ok) throw new Error(`companion_upload_create_${created.status}`);
    const { uploadId } = await created.json();
    const chunkSize = 1024 * 1024;
    for (let start = 0, index = 0; start < content.length || (content.length === 0 && index === 0); start += chunkSize, index += 1) {
      const chunk = content.subarray(start, Math.min(content.length, start + chunkSize));
      const checksum = crypto.createHash("sha256").update(chunk).digest("hex");
      const response = await this.request(
        `/api/uploads/${encodeURIComponent(uploadId)}/chunks/${index}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", "X-Chunk-SHA256": checksum },
          body: chunk,
        },
      );
      if (!response.ok) throw new Error(`companion_upload_chunk_${response.status}`);
    }
    const complete = await this.request(`/api/uploads/${encodeURIComponent(uploadId)}/complete`, {
      method: "POST",
    });
    if (!complete.ok) throw new Error(`companion_upload_complete_${complete.status}`);
    return complete.json();
  }

  async execute(job) {
    const payload = job.payload && typeof job.payload === "object" ? job.payload : {};
    const grant = this.config.grants?.[payload.grantId];
    this.onAccess(true, job.capability);
    try {
      if (job.capability === "notifications") {
        this.notify(String(payload.title || "Jarvis"), String(payload.body || ""));
        return { ok: true };
      }
      if (job.capability === "desktop_ui") {
        if (payload.action !== "show" || typeof this.showMain !== "function") {
          throw new Error("invalid_desktop_ui_action");
        }
        this.showMain();
        return { ok: true, action: "show" };
      }
      if (!grant) throw new Error("grant_not_found");
      const target = insideGrant(grant.root, String(payload.relativePath || ""));
      if (job.capability === "files.list") {
        if (!fs.statSync(target).isDirectory()) throw new Error("grant_not_directory");
        return { ok: true, entries: fs.readdirSync(target, { withFileTypes: true }).map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? "directory" : "file" })) };
      }
      if (job.capability === "files.read" || job.capability === "files.upload") {
        const stat = fs.statSync(target);
        if (!stat.isFile() || stat.size > 25 * 1024 * 1024) throw new Error("grant_file_rejected");
        if (job.capability === "files.upload") {
          const file = await this.uploadFile(target, payload);
          return { ok: true, fileId: file.fileId, version: file.version };
        }
        return { ok: true, name: path.basename(target), size: stat.size, contentBase64: fs.readFileSync(target).toString("base64") };
      }
      throw new Error("companion_capability_not_implemented");
    } finally {
      this.onAccess(false, job.capability);
    }
  }

  async poll() {
    if (!this.config.token || this.running) return;
    this.running = true;
    let retryDelay = null;
    try {
      const response = await this.request("/api/devices/jobs?wait=20");
      if (response.status === 401) {
        this.config.token = null;
        this.save();
        this.polling = false;
        return;
      }
      if (!response.ok) {
        retryDelay = this.retryDelayMs;
        return;
      }
      const { jobs } = await response.json();
      for (const job of jobs || []) {
        let result;
        try {
          result = await this.execute(job);
        } catch (error) {
          result = { ok: false, error: error instanceof Error ? error.message : "companion_failed" };
        }
        await this.request(`/api/devices/jobs/${encodeURIComponent(job.jobId)}/result`, {
          method: "POST",
          body: JSON.stringify({ nonce: job.nonce, result }),
        });
      }
      this.retryDelayMs = 1_000;
    } catch {
      retryDelay = this.retryDelayMs;
    } finally {
      this.running = false;
      if (this.polling && this.config.token) {
        this.schedulePoll(retryDelay ?? 0);
        if (retryDelay !== null) {
          this.retryDelayMs = Math.min(this.retryDelayMs * 2, 30_000);
        }
      }
    }
  }

  schedulePoll(delayMs) {
    if (!this.polling) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delayMs);
  }

  start() {
    if (this.polling || !this.config.token) return;
    this.polling = true;
    void this.poll();
  }

  stop() {
    this.polling = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.retryDelayMs = 1_000;
  }
}

module.exports = { JarvisCompanion, insideGrant };
