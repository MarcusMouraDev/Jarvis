# Clientes privados e workspace central

## iPhone e iPad

1. Entre no tailnet pelo Tailscale.
2. Abra a URL HTTPS privada do Jarvis no Safari e use **Adicionar à Tela de Início**.
3. Em **Arquivos**, escolha documentos pelo seletor do iOS. O upload usa blocos de 1 MiB, checksum e retry; escolher o mesmo arquivo novamente retoma o `uploadId` salvo, sem cachear conteúdo.

O service worker guarda somente `/_next/static` e o ícone. APIs, navegação autenticada e documentos nunca entram no cache offline.

## Mac companion

Defina `JARVIS_URL=https://jarvis.<tailnet>.ts.net/` antes de abrir `npm run desktop`. Em **Dispositivos**:

1. Gere código.
2. Clique **Ativar neste Mac**. O token é cifrado pelo Electron `safeStorage`/Keychain.
3. Use **Autorizar pasta** para criar grant local persistente; o servidor recebe somente ID, rótulo e nível de acesso.
4. Use **Subir arquivo** para copiar explicitamente um arquivo ao workspace central.

Leitura por job rejeita caminhos absolutos, `..` e qualquer symlink. Tray e UI indicam acesso ativo. Automação exige envelope `approved: true` e continua sujeita à aprovação do Jarvis.

## Telegram

Configure `JARVIS_TELEGRAM_BOT_TOKEN` apenas no ambiente do `jarvis-worker`. No painel, gere código e envie `/link CODIGO` em conversa privada. Grupos são ignorados.

- `/files` lista documentos centrais.
- `/file FILE_ID` envia uma cópia.
- Documento recebido entra em `Inbox`; nome repetido cria nova versão.
- `/unlink` revoga imediatamente.
- Callbacks `approve:RUN_ID` e `deny:RUN_ID` são idempotentes.

O worker usa long polling; webhook e Funnel não são necessários.
