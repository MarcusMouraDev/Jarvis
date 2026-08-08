# Baseline verificada

## Referência

- Base: `d35ac2028a37a1ad6742e3f71dfe0c02a63d152b` — Jarvis V23.
- Branch de evolução: `codex/jarvis-evolution-core`.
- Política: Ponytail — menor diff correto, reutilização da stack existente e nenhuma dependência nova para o M1 sem necessidade demonstrada.

## Estado da Task 1

Os testes que gravavam diretamente no diretório padrão agora injetam `JARVIS_DATA_DIR` temporário. O diretório padrão continua compatível para o runtime V23; somente o ambiente de teste usa isolamento explícito.

## Evidência de verificação — 2026-08-08

| Comando | Resultado |
|---------|-----------|
| `npm run lint` | sucesso |
| `npm run typecheck` | sucesso; a execução precisa permissão para criar o arquivo incremental ignorado pelo Git |
| `npm test` | 24 arquivos e 85 testes aprovados |
| `npm run test:e2e` | sucesso no baseline Playwright viável |

Antes do isolamento, a suite unitária apresentava falhas causadas por escrita concorrente no diretório padrão do runtime. Elas foram eliminadas com `JARVIS_DATA_DIR` temporário; não há falhas introduzidas conhecidas nesta Task 1.
