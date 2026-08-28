import type { ComposerChip } from "./mention-types";
import type { HermesAttachment } from "@/integrations/hermes/bridge";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp)$/i;

export function attachmentsFromChips(chips: readonly ComposerChip[]): HermesAttachment[] {
  const attachments: HermesAttachment[] = [];
  for (const chip of chips) {
    if (chip.kind === "image") {
      if (chip.path) {
        attachments.push({ kind: "image", path: chip.path });
      } else if (chip.contentBase64) {
        attachments.push({
          kind: "image-bytes",
          contentBase64: chip.contentBase64,
          filename: chip.filename,
        });
      }
      continue;
    }
    if (chip.kind !== "path") continue;
    const absPath = chip.summary.absPath;
    if (!absPath) continue;
    attachments.push(
      IMAGE_EXT.test(absPath)
        ? { kind: "image", path: absPath }
        : { kind: "file", path: absPath },
    );
  }
  return attachments.slice(0, 8);
}
