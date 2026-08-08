# Relatório — Task 1: Documentation and clean baseline

## Escopo entregue

- Documentação permanente em português para produto, arquitetura, segurança, roadmap, pesquisa, ADR, especificação, plano e baseline.
- README e DESIGN atualizados para V23; DESIGN concentra-se no sistema visual e referencia os documentos técnicos.
- Isolamento de persistence tests por `JARVIS_DATA_DIR` temporário.
- Helper central `getJarvisDataDir` reutilizado por ledger, history e scheduler, preservando o diretório padrão quando a variável não é definida.

## Arquivos

- Criados: `docs/**`, `src/core/data-dir.ts` e este relatório.
- Atualizados: `README.md`, `DESIGN.md`, `src/core/run-ledger.ts`, `src/core/history-store.ts`, `src/scheduler/store.ts` e seus testes próximos.

## Decisões

- Foi criado um helper mínimo de diretório de dados, em vez de três leituras independentes de ambiente, para eliminar o ponto comum de persistência sem alterar a semântica V23.
- Os testes criam e removem diretórios temporários por caso. Isso elimina escrita no diretório de runtime e estado compartilhado, sem mocks ou limpeza de dados do usuário.
- A documentação registra a base V23 verificada, a branch de evolução e as restrições Ponytail, sem caminhos locais, credenciais, prompts brutos ou detalhes exploráveis.

## Verificação

| Comando | Resultado |
|---------|-----------|
| `npm test -- src/core/run-ledger.test.ts src/core/history-store.test.ts src/scheduler/scheduler.test.ts` | 3 arquivos e 11 testes aprovados após o ciclo RED/GREEN |
| `npm run lint` | sucesso |
| `npm run typecheck` | sucesso; requer permissão de escrita somente para o arquivo incremental ignorado pelo Git |
| `npm test` | 24 arquivos e 85 testes aprovados |
| `npm run test:e2e` | sucesso no baseline Playwright viável |
| `git diff --check` | sucesso na revisão final antes do commit |

## Baseline de falhas

Antes da correção, 8 testes de ledger/history falhavam por tentar gravar no diretório padrão e 2 testes de scheduler falhavam pelo estado persistente compartilhado. Após o isolamento, a suite unitária está em 85/85. Não foram observadas falhas introduzidas.

## Riscos e acompanhamento

- `JARVIS_DATA_DIR` é lido no momento da operação; processos que o alterem em execução devem isolar o ambiente por processo, como a suite faz.
- A Task 3 deve reutilizar este ponto central ao introduzir o banco do núcleo.
- O E2E continua dependente do ambiente local do Playwright, mas o baseline viável foi executado nesta Task 1.
