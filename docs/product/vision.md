# Visão de produto

## Propósito

Jarvis é uma interface local para trabalho assistido por modelos, ferramentas e contexto de projeto. A experiência deve manter a presença visual do V23, tornar o estado operacional compreensível e exigir consentimento antes de efeitos relevantes.

## Resultado desejado

O Safe Agent Core transforma pedidos em execuções auditáveis: a pessoa escolhe ou confirma o agente, vê o provedor e o modelo efetivos, revisa aprovações precisas e pode retomar a mesma execução após uma decisão.

## Princípios de produto

- Preservar V23 quando `JARVIS_SAFE_AGENT_CORE=0`.
- Preferir clareza operacional a automação opaca.
- Limitar efeitos por escopo, política e aprovação vinculada ao pedido exato.
- Manter dados confidenciais fora de logs, eventos e superfícies públicas.
- Fazer do estado do backend a fonte de verdade para a interface.

## Fora de escopo do M1

O M1 não introduz um framework de agentes, ORM, novo canal de execução paralelo ou ferramentas destrutivas genéricas. Também não migra os armazenamentos legados de memória e agendamento.
