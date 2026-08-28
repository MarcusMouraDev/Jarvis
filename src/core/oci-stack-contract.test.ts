import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type ComposeService = {
  image?: string;
  ports?: string[];
  expose?: string[];
  environment?: Record<string, string>;
  volumes?: string[];
};

type ComposeFile = {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
};

function yamlFile<T>(relativePath: string): T {
  const filePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(process.cwd(), relativePath);
  return parse(
    readFileSync(filePath, "utf8"),
    { merge: true },
  ) as T;
}

describe("OCI stack contract", () => {
  it("keeps Electron available for desktop while excluding it from the VPS-safe image", () => {
    const dockerfile = readFileSync(path.join(process.cwd(), "Dockerfile"), "utf8");
    const nextConfig = readFileSync(path.join(process.cwd(), "next.config.ts"), "utf8");
    const dockerignore = readFileSync(path.join(process.cwd(), ".dockerignore"), "utf8");
    const ensureElectron = readFileSync(
      path.join(process.cwd(), "scripts", "ensure-electron.mjs"),
      "utf8",
    );

    expect(dockerfile).toContain("ARG JARVIS_BUILD_PROFILE=vps-safe");
    expect(dockerfile).toContain("RUN npm run build:vps");
    expect(dockerfile).toContain("ELECTRON_SKIP_BINARY_DOWNLOAD=1");
    expect(nextConfig).toContain("outputFileTracingExcludes");
    expect(nextConfig).toContain("./node_modules/electron/**/*");
    expect(dockerignore).toContain("node_modules");
    expect(dockerignore).toContain("graphify-out");
    expect(ensureElectron).toContain("JARVIS_SKIP_ELECTRON");
    expect(
      readFileSync(path.join(process.cwd(), "scripts", "assert-vps-standalone.mjs"), "utf8"),
    ).toContain("vps_auth_route_heavy_runtime");
    expect(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).toContain(
      '"build:vps"',
    );
    expect(readFileSync(path.join(process.cwd(), "package.json"), "utf8")).toContain(
      '"build:desktop"',
    );
  });

  it("separates localhost web ingress from the private broker worker", () => {
    const compose = yamlFile<ComposeFile>("docker-compose.yml");
    const web = compose.services["jarvis-web"];
    const worker = compose.services["jarvis-worker"];

    expect(web.ports).toEqual(["127.0.0.1:3000:3000"]);
    expect(web.environment?.JARVIS_BROKER_ENABLED).toBe("0");
    expect(worker.ports).toBeUndefined();
    expect(worker.expose).toEqual(["3001"]);
    expect(worker.environment).toMatchObject({
      JARVIS_BROKER_ENABLED: "1",
      JARVIS_INTERNAL_HOSTS: "jarvis-worker:3001",
      PORT: "3001",
    });
  });

  it("configures Hermes to use only custom:jarvis-broker", () => {
    const hermes = yamlFile<{
      model: { default: string; provider: string };
      providers: Record<string, Record<string, unknown>>;
    }>("config/hermes/config.yaml");

    expect(hermes.model).toEqual({
      default: "jarvis-broker",
      provider: "custom:jarvis-broker",
    });
    expect(hermes.providers["jarvis-broker"]).toMatchObject({
      api: "http://jarvis-worker:3001/api/internal/hermes/v1",
      key_env: "HERMES_BROKER_TOKEN",
      transport: "chat_completions",
      default_model: "jarvis-broker",
      discover_models: false,
    });
  });

  it("merges broker config without erasing existing Hermes capabilities", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jarvis-hermes-config-"));
    const target = path.join(directory, "config.yaml");
    writeFileSync(
      target,
      [
        "model:",
        "  max_tokens: 4096",
        "providers:",
        "  existing:",
        "    api: https://example.invalid/v1",
        "gateway:",
        "  platforms:",
        "    telegram:",
        "      enabled: true",
        "",
      ].join("\n"),
    );

    try {
      const result = spawnSync(
        process.execPath,
        [
          "scripts/configure-hermes-broker.mjs",
          target,
          "config/hermes/config.yaml",
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      const merged = yamlFile<Record<string, unknown>>(target);
      expect(merged).toMatchObject({
        model: {
          max_tokens: 4096,
          default: "jarvis-broker",
          provider: "custom:jarvis-broker",
        },
        providers: {
          existing: { api: "https://example.invalid/v1" },
          "jarvis-broker": {
            api: "http://jarvis-worker:3001/api/internal/hermes/v1",
          },
        },
        gateway: { platforms: { telegram: { enabled: true } } },
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses only /srv/jarvis bind mounts and digest-pinned image variables", () => {
    const compose = yamlFile<ComposeFile>("docker-compose.yml");
    const services = Object.values(compose.services);

    expect(compose.volumes).toBeUndefined();
    expect(services.flatMap((service) => service.volumes ?? [])).toEqual(
      expect.arrayContaining([
        "/srv/jarvis/data:/var/lib/jarvis",
        "/srv/jarvis/hermes:/var/lib/hermes",
        "/srv/jarvis/omniroute:/app/data",
        "/srv/jarvis/workspaces:/workspaces",
      ]),
    );
    for (const service of services) {
      expect(service.image).toMatch(/^\$\{[A-Z_]+_IMAGE:\?.+@sha256/);
    }
    expect(compose.services.omniroute.environment).toMatchObject({
      DATA_DIR: "/app/data",
    });
  });

  it("mounts the OCI block volume at the canonical /srv/jarvis root", () => {
    const cloud = yamlFile<{
      runcmd: string[];
      write_files: Array<{ path: string; content: string }>;
    }>("infra/oci/cloud-init.yaml.tftpl");
    const commands = cloud.runcmd.join("\n");
    const tailscaleBootstrap = cloud.write_files.find(
      (file) => file.path === "/opt/jarvis/bootstrap-tailscale.sh",
    )?.content;

    expect(commands).toContain("mount /dev/oracleoci/oraclevdb /srv/jarvis");
    expect(commands).toContain(
      "mkdir -p /srv/jarvis/data /srv/jarvis/hermes /srv/jarvis/omniroute /srv/jarvis/workspaces /srv/jarvis/backups",
    );
    expect(commands).not.toContain("mount /dev/oracleoci/oraclevdb /srv/jarvis/data");
    expect(commands.indexOf("mount /dev/oracleoci/oraclevdb /srv/jarvis")).toBeLessThan(
      commands.indexOf("mkdir -p /srv/jarvis/data"),
    );
    expect(tailscaleBootstrap).toContain(
      "tailscale serve --bg http://127.0.0.1:3000",
    );
    expect(tailscaleBootstrap).not.toContain("tailscale funnel");
  });

  it("backs up a stopped stack, proves restore, then restarts only prior services", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jarvis-backup-"));
    const dataRoot = path.join(directory, "state");
    const fakeBin = path.join(directory, "bin");
    const callLog = path.join(directory, "calls.log");
    const passwordFile = path.join(directory, "restic-password");
    for (const child of ["data", "hermes", "omniroute", "workspaces", "backups"]) {
      writeFileSync(path.join(directory, `.keep-${child}`), "");
    }
    writeFileSync(passwordFile, "test-only-password\n", { mode: 0o600 });
    writeFileSync(
      path.join(directory, "docker"),
      [
        "#!/usr/bin/env bash",
        "printf 'docker %s\\n' \"$*\" >> \"$CALL_LOG\"",
        "if [[ \"$*\" == *'ps --services --filter status=running'* ]]; then",
        "  printf 'jarvis-web\\nhermes\\n'",
        "fi",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(directory, "restic"),
      [
        "#!/usr/bin/env bash",
        "printf 'restic %s\\n' \"$*\" >> \"$CALL_LOG\"",
        "if [[ \"$1\" == 'restore' ]]; then",
        "  while [[ $# -gt 0 ]]; do",
        "    if [[ \"$1\" == '--target' ]]; then target=\"$2\"; break; fi",
        "    shift",
        "  done",
        "  mkdir -p \"$target$JARVIS_DATA_ROOT/data\" \"$target$JARVIS_DATA_ROOT/hermes\" \"$target$JARVIS_DATA_ROOT/omniroute\" \"$target$JARVIS_DATA_ROOT/workspaces\"",
        "fi",
        "",
      ].join("\n"),
    );
    mkdirSync(dataRoot, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    for (const name of ["docker", "restic"]) {
      renameSync(path.join(directory, name), path.join(fakeBin, name));
      chmodSync(path.join(fakeBin, name), 0o755);
    }
    for (const child of ["data", "hermes", "omniroute", "workspaces", "backups"]) {
      mkdirSync(path.join(dataRoot, child), { recursive: true });
    }

    try {
      const result = spawnSync("bash", ["scripts/backup-oci.sh"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          CALL_LOG: callLog,
          JARVIS_DATA_ROOT: dataRoot,
          JARVIS_COMPOSE_PROJECT_DIR: process.cwd(),
          RESTIC_REPOSITORY: path.join(dataRoot, "backups", "restic"),
          RESTIC_PASSWORD_FILE: passwordFile,
        },
      });
      expect(result.status, result.stderr).toBe(0);
      const calls = readFileSync(callLog, "utf8");
      expect(calls).toContain("stop jarvis-web hermes");
      expect(calls).toContain(
        `restic backup ${dataRoot}/data ${dataRoot}/hermes ${dataRoot}/omniroute ${dataRoot}/workspaces`,
      );
      expect(calls).toContain("restic restore latest");
      expect(calls).toContain("restic check --read-data-subset=1/20");
      expect(calls).toContain("start jarvis-web hermes");
      expect(calls.indexOf("stop jarvis-web hermes")).toBeLessThan(
        calls.indexOf("restic backup"),
      );
      expect(calls.indexOf("restic restore latest")).toBeLessThan(
        calls.indexOf("start jarvis-web hermes"),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates named volumes to bind mounts without deleting their source", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jarvis-volume-migration-"));
    const dataRoot = path.join(directory, "state");
    const volumesRoot = path.join(directory, "volumes");
    const fakeBin = path.join(directory, "bin");
    const callLog = path.join(directory, "calls.log");
    mkdirSync(dataRoot, { recursive: true });
    mkdirSync(volumesRoot, { recursive: true });
    mkdirSync(fakeBin, { recursive: true });
    const mapping: Record<string, string> = {
      "jarvis-data": "data",
      "hermes-data": "hermes",
      "jarvis-workspaces": "workspaces",
    };
    for (const [volume, destination] of Object.entries(mapping)) {
      mkdirSync(path.join(volumesRoot, volume), { recursive: true });
      mkdirSync(path.join(dataRoot, destination), { recursive: true });
      writeFileSync(path.join(volumesRoot, volume, `${destination}.txt`), volume);
    }
    mkdirSync(path.join(dataRoot, "omniroute"), { recursive: true });
    writeFileSync(
      path.join(fakeBin, "docker"),
      [
        "#!/usr/bin/env bash",
        "printf 'docker %s\\n' \"$*\" >> \"$CALL_LOG\"",
        "if [[ \"$*\" == *'ps --services --filter status=running'* ]]; then",
        "  printf 'jarvis-web\\nhermes\\n'",
        "elif [[ \"$1 $2\" == 'volume inspect' ]]; then",
        "  volume=\"${@: -1}\"",
        "  if [[ -d \"$VOLUMES_ROOT/$volume\" ]]; then printf '%s\\n' \"$VOLUMES_ROOT/$volume\"; else exit 1; fi",
        "fi",
        "",
      ].join("\n"),
    );
    writeFileSync(
      path.join(fakeBin, "sudo"),
      "#!/usr/bin/env bash\nexec \"$@\"\n",
    );
    for (const name of ["docker", "sudo"]) chmodSync(path.join(fakeBin, name), 0o755);

    try {
      const result = spawnSync("bash", ["scripts/migrate-oci-volumes.sh"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${fakeBin}:${process.env.PATH}`,
          CALL_LOG: callLog,
          VOLUMES_ROOT: volumesRoot,
          JARVIS_DATA_ROOT: dataRoot,
          JARVIS_COMPOSE_PROJECT_DIR: process.cwd(),
        },
      });
      expect(result.status, result.stderr).toBe(0);
      for (const [volume, destination] of Object.entries(mapping)) {
        expect(readFileSync(path.join(dataRoot, destination, `${destination}.txt`), "utf8")).toBe(volume);
        expect(readFileSync(path.join(volumesRoot, volume, `${destination}.txt`), "utf8")).toBe(volume);
      }
      const calls = readFileSync(callLog, "utf8");
      expect(calls).toContain("stop jarvis-web hermes");
      expect(calls).toContain("start jarvis-web hermes");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("stages a checked restore without overwriting an existing target", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "jarvis-restore-"));
    const dataRoot = path.join(directory, "state");
    const fakeBin = path.join(directory, "bin");
    const callLog = path.join(directory, "calls.log");
    const passwordFile = path.join(directory, "restic-password");
    const target = path.join(dataRoot, "restore", "drill");
    mkdirSync(fakeBin, { recursive: true });
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(passwordFile, "test-only-password\n", { mode: 0o600 });
    writeFileSync(
      path.join(fakeBin, "restic"),
      [
        "#!/usr/bin/env bash",
        "printf 'restic %s\\n' \"$*\" >> \"$CALL_LOG\"",
        "if [[ \"$1\" == 'restore' ]]; then",
        "  while [[ $# -gt 0 ]]; do",
        "    if [[ \"$1\" == '--target' ]]; then target=\"$2\"; break; fi",
        "    shift",
        "  done",
        "  mkdir -p \"$target$JARVIS_DATA_ROOT/data\" \"$target$JARVIS_DATA_ROOT/hermes\" \"$target$JARVIS_DATA_ROOT/omniroute\" \"$target$JARVIS_DATA_ROOT/workspaces\"",
        "fi",
        "",
      ].join("\n"),
    );
    chmodSync(path.join(fakeBin, "restic"), 0o755);
    const env = {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      CALL_LOG: callLog,
      JARVIS_DATA_ROOT: dataRoot,
      RESTIC_REPOSITORY: path.join(dataRoot, "backups", "restic"),
      RESTIC_PASSWORD_FILE: passwordFile,
    };

    try {
      const first = spawnSync("bash", ["scripts/restore-oci.sh", target], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      });
      const second = spawnSync("bash", ["scripts/restore-oci.sh", target], {
        cwd: process.cwd(),
        encoding: "utf8",
        env,
      });
      expect(first.status, first.stderr).toBe(0);
      expect(second.status).toBe(2);
      const calls = readFileSync(callLog, "utf8");
      expect(calls).toContain("restic check --read-data-subset=1/20");
      expect(calls).toContain("restic restore latest");
      expect(second.stderr).toContain("restore target is not empty");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
