# Pesquisa e decisões técnicas

## Reutilização antes de adição

O projeto já possui Next.js, Zod, YAML, better-sqlite3, Vitest e Playwright. Esses componentes cobrem UI/API, validação, configuração, persistência e testes do M1; não será introduzido framework de agentes, ORM ou caminho de execução duplicado.

## SQLite para o núcleo

`better-sqlite3` já é dependência do projeto e permite transações locais, WAL, timeout de bloqueio e migrações numeradas. O núcleo usará SQLite para a sequência de eventos e estado de aprovações, enquanto memória e scheduler legados ficam fora da migração inicial.

## Eventos antes de SSE

Persistir o envelope antes de emiti-lo permite reconstrução após recarga e replay a partir de `Last-Event-ID`. O protocolo inclui versão, identificador de evento, execução, sequência, instante, tipo e payload sanitizado.

## Aprovação vinculada ao efeito

Uma confirmação genérica é insuficiente para operações com efeito. A decisão é vinculada à versão da ferramenta e ao pedido normalizado, o que reduz reutilização indevida e permite retomar a mesma execução com rastreabilidade.

## Caminho seguro opt-in

A flag `JARVIS_SAFE_AGENT_CORE` preserva a compatibilidade V23 durante a entrega incremental. No modo seguro, a exclusividade do Tool Gateway evita que uma rota legada execute o mesmo efeito por fora dos controles.
