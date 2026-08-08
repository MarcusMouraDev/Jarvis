# Especificação — Jarvis Evolution: Safe Agent Core

## Objetivo

Entregar um núcleo local seguro para agentes que preserve o V23 e governe workspace, efeitos, privacidade, aprovações e estado de execução.

## Restrições globais

- Base verificada: `d35ac2028a37a1ad6742e3f71dfe0c02a63d152b`.
- A evolução ocorre em `codex/jarvis-evolution-core`.
- Aplicar Ponytail: reutilizar a stack existente, sem dependências ou camadas não necessárias.
- Com `JARVIS_SAFE_AGENT_CORE=0`, preservar memória, scheduler, browser e fluxos legados do V23.
- Com `JARVIS_SAFE_AGENT_CORE=1`, todo efeito usa o Tool Gateway.
- Não registrar ou publicar segredos, caminhos locais, credenciais, prompts brutos ou detalhes exploráveis.
- Testes de filesystem usam `JARVIS_DATA_DIR` temporário e injetado.

## Requisitos funcionais

### Agentes e workspace

`config/agents.yaml` será a fonte única dos agentes Hermes, Planner, Developer e Builder. A configuração deve ser validada por Zod e falhar para referências inválidas, ciclos, limites, riscos ou workspace incompatível. O workspace é resolvido uma vez por execução e deve impedir traversal, symlinks e escape.

### Persistência

O núcleo grava em SQLite sessões, execuções, mensagens, eventos ordenados, invocações e aprovações. A importação de histórico e ledger JSONL ocorre uma única vez, em transação, registra linhas inválidas, expira aprovações importadas e não migra memória ou scheduler.

### Sessão e execução

Rotas seguras aceitam somente loopback, validam Host/Origin e CSRF e usam cookie HttpOnly SameSite=Strict com validade de 24 horas. Eventos são persistidos antes do SSE, têm heartbeat de 15 segundos e podem ser reproduzidos por `Last-Event-ID`.

### Ferramentas, modelos e orquestração

Ferramentas possuem manifests Zod versionados e descrevem entrada, saída, escopo, risco, efeito, idempotência, timeout e prévia. Aprovações vinculam o efeito exato, expiram em dez minutos e são consumidas uma vez. Provedores normalizam eventos e respeitam privacidade; fallback é visível, limitado e não reaplica efeitos incertos. O orquestrador limita passos, tempo, custo e mutações simultâneas.

O núcleo seguro usa `local` como modelo padrão e orçamento de nuvem zero. Providers que podem gerar cobrança permanecem desativados até opt-in explícito; não existe fallback automático de local para nuvem. Conteúdo confidencial ou secreto só pode sair do dispositivo quando uma aprovação corresponder ao digest exato do conteúdo e do destino efetivo. Essa decisão substitui a preferência anterior por Gemini como padrão sem alterar o fluxo legado V23.

### Interface

A interface mostra Hermes como padrão, agente imutável durante a execução, provedor/modelo efetivos, estado operacional e cartão de aprovação sanitizado. Uma recarga reconstrói o estado a partir do armazenamento.

## Verificação

O M1 exige testes unitários, integração, segurança e E2E para manifests, aprovações, migração, sessão, workspace, privacidade, agentes, fallback, orquestração, SSE, cancelamento e recarga. A entrega executa lint, typecheck, testes, build e Playwright e classifica bloqueios ambientais separadamente.
