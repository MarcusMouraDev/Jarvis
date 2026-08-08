# Arquitetura do Jarvis Evolution

## Contexto

O V23 reúne interface Next.js, adaptadores de modelos, ferramentas, memória, histórico, ledger e recursos opcionais de browser e agendamento. O Safe Agent Core acrescenta um caminho seguro ativado por flag, sem mudar o caminho legado quando a flag estiver desativada.

## Componentes do M1

1. **Agent catalog** valida agentes, modelos, ferramentas, limites e compatibilidade de workspace.
2. **Workspace policy** fixa o workspace de cada execução e impede saídas de escopo.
3. **Event store** persiste sessões, execuções, mensagens, eventos, invocações e aprovações em SQLite.
4. **Session security** protege rotas locais com cookie, CSRF e validação de Host/Origin.
5. **Tool Gateway** concentra efeitos e aplica manifests, escopos, risco, idempotência e aprovações.
6. **Model gateway e orchestrator** normalizam provedores, privacidade, fallback e orçamento.
7. **API e UI** expõem eventos SSE reproduzíveis, estado de execução e aprovações exatas.

## Fluxo seguro

Quando `JARVIS_SAFE_AGENT_CORE=1`, uma solicitação cria uma execução vinculada ao agente e workspace escolhidos. O orquestrador registra eventos antes de emiti-los. Toda ferramenta com efeito atravessa o Tool Gateway; operações que exigem consentimento aguardam uma aprovação vinculada à execução e à entrada exatas. Depois da decisão, a mesma execução continua ou encerra com estado registrado.

## Compatibilidade

O Safe Agent Core é opt-in. Com a flag desativada, as rotas e comportamentos V23 continuam ativos. Com a flag ativada, não há caminho alternativo para contornar o Tool Gateway.

O design visual permanece em [DESIGN.md](../../DESIGN.md). Os detalhes de segurança estão em [Segurança](../security/safe-agent-core.md) e a sequência de entrega em [Plano de implementação](../plans/jarvis-evolution-core.md).
