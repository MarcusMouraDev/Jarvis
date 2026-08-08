# Segurança do Safe Agent Core

## Limites

O M1 opera somente em loopback, protege mutações com sessão e CSRF e valida Host/Origin. Não habilita CORS para contornar esses controles.

## Dados e persistência

- Segredos são redigidos antes de persistência ou emissão de eventos.
- Dados em disco ficam em `JARVIS_DATA_DIR` quando definido; o diretório padrão preserva o comportamento V23.
- A migração legada é transacional, idempotente e registra falhas de importação sem expor conteúdo sensível.
- Aprovações legadas importadas são tratadas como expiradas.

## Efeitos e aprovações

O Tool Gateway é a autoridade exclusiva para efeitos no modo seguro. Cada invocação carrega manifest versionado, escopo, risco, metadados de efeito, idempotência e timeout. Escritas, rede e scripts exigem confirmação precisa; comandos destrutivos arbitrários não fazem parte do M1.

Uma aprovação expira em dez minutos e é ligada à sessão, execução, invocação, versão da ferramenta, workspace, entrada normalizada e efeito previstos. Ela é consumida uma única vez de forma transacional; efeitos de resultado desconhecido não são repetidos automaticamente.

## Privacidade

Conteúdo confidencial ou secreto segue para execução local. Qualquer envio a provedor externo exige uma aprovação vinculada ao conteúdo, contexto, provedor e modelo efetivos. Logs, eventos e documentação devem usar somente alvos sanitizados e prévias seguras.
