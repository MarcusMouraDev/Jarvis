import type { PathContextSummary } from "@/composer/mention-types";

export function formatContextBlocks(
  blocks: PathContextSummary[],
): string {
  if (!blocks.length) return "";

  const parts = blocks.map((b, i) => {
    const exports = b.exports.length ? b.exports.join(", ") : "—";
    const imports = b.imports.length ? b.imports.slice(0, 12).join(", ") : "—";
    const symbols = b.symbols.length ? b.symbols.slice(0, 16).join(", ") : "—";
    return [
      `### Contexto ${i + 1}: ${b.relPath}`,
      `- linguagem: ${b.language}`,
      `- hash: ${b.hash}`,
      `- tamanho: ${b.byteSize} bytes · ${b.lineCount} linhas`,
      `- exports: ${exports}`,
      `- imports: ${imports}`,
      `- símbolos: ${symbols}`,
      "```",
      b.excerpt,
      "```",
    ].join("\n");
  });

  return [
    "## Contexto local anexado pelo usuário",
    "Use apenas como referência. Não invente conteúdo fora desses trechos.",
    ...parts,
  ].join("\n\n");
}
