# ADR-0001: Adotar um núcleo seguro opt-in com Tool Gateway único

- Status: Aceita
- Data: 2026-08-08

## Contexto

O V23 já possui recursos de chat, ferramentas, memória e integrações. A evolução precisa ampliar automação sem permitir efeitos sem política, contexto ou consentimento verificáveis.

## Decisão

Adicionar o Safe Agent Core atrás de `JARVIS_SAFE_AGENT_CORE`. No modo seguro, o Tool Gateway será a única autoridade de execução com efeitos. Sessões, execuções, eventos e aprovações serão persistidos em SQLite; a interface receberá eventos SSE reproduzíveis.

## Consequências

- O V23 permanece compatível enquanto a flag estiver desativada.
- Rotas seguras não podem manter bypass para executores legados.
- A entrega exige manifests versionados, workspace fixo, política de privacidade e testes de corrida, replay e expiração.
- O custo de implementação é maior que expor ferramentas diretamente, mas o estado fica auditável e recuperável.
