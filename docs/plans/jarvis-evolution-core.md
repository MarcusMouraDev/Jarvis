# Plano de implementação — Jarvis Evolution: Safe Agent Core

> Execução incremental: cada etapa preserva o V23, inclui testes focados e um commit independente.

## 1. Documentação e baseline

Criar a documentação permanente, registrar a base verificada, atualizar referências V23 e isolar os testes de filesystem por `JARVIS_DATA_DIR`.

## 2. Catálogo e workspace

Adicionar `config/agents.yaml`, carregadores validados e política de workspace congelado por execução. Remover perfis do fluxo seguro, mantendo-os no legado.

## 3. Event store

Criar schema SQLite, migrações numeradas, WAL e timeout. Persistir os objetos do núcleo e importar JSONL de forma idempotente sem migrar memória ou scheduler.

## 4. Segurança de sessão

Aplicar loopback, Host/Origin, cookie de sessão, bootstrap CSRF e bloqueio de efeitos legados no modo seguro.

## 5. Tool Gateway

Definir manifests e implementar `code.context`, `terminal.read`, `terminal.run`, `file.patch` e `project.create`. Aplicar política, escopo e máquina de estados de aprovação.

## 6. Model gateway e orquestrador

Normalizar adaptadores, fallback visível, privacidade, orçamento, timeout, cancelamento e retomada da mesma execução.

## 7. API, SSE e UI

Expor sessão, agentes, workspace, execuções, stream, cancelamento e decisão. Reconstruir a interface a partir de eventos persistidos.

## 8. Verificação e entrega

Completar cobertura de segurança e E2E, rodar lint, typecheck, testes, build e Playwright, classificar bloqueios e preparar o rastreamento do M1.

## Critério de passagem por etapa

Cada etapa deve começar por teste que falha para um comportamento novo ou corrigido, aplicar a menor mudança central possível e encerrar com verificações proporcionais e revisão do diff.
