import path from "node:path";

export function getJarvisDataDir(): string {
  return process.env.JARVIS_DATA_DIR ?? path.join(process.cwd(), ".jarvis");
}
