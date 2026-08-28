# OCI Always Free A1

Perfil alvo: Ubuntu 24.04 ARM64, `VM.Standard.A1.Flex`, 2 OCPU, 12 GB RAM, 50 GB boot + 100 GB data. Oracle pode negar capacidade; nunca trocar automaticamente por shape pago.

## Provisionar

1. Validar tenancy, região home, quota A1 e imagem ARM64.
2. Aplicar `infra/oci` com OpenTofu. `shape`, OCPU e memória têm validação contra o teto Always Free.
3. Entrar somente por Tailscale. Nenhum serviço Jarvis, Hermes ou OmniRoute recebe porta pública.
4. Confirmar que o volume de dados inteiro está montado em `/srv/jarvis`; os subdiretórios `data`, `hermes`, `omniroute`, `workspaces` e `backups` ficam no mesmo disco.
5. Copiar `.env.oci.example` para `.env`, substituir todos os digests por imagens ARM64 verificadas e montar o segredo Restic fora do Git. Compose recusa imagens sem variável explícita.
6. Em instalação que usava named volumes, executar `scripts/migrate-oci-volumes.sh`. O script para somente serviços ativos, copia e compara o conteúdo em staging, troca destinos vazios e mantém volumes de origem intactos.
7. Executar `docker compose --profile oci-a1-free up -d`. O serviço one-shot `hermes-config` mescla `custom:jarvis-broker` em `HERMES_HOME/config.yaml` sem apagar Telegram, memória ou outras configurações existentes.
8. Se Telegram for usado, definir `JARVIS_TELEGRAM_BOT_TOKEN` no `.env`. Somente `jarvis-worker` recebe o segredo e executa long polling.

`cloud-init` configura somente Tailscale Serve para `http://127.0.0.1:3000`; Funnel não é usado. Preencha `JARVIS_TAILSCALE_HOSTS` e `JARVIS_TAILSCALE_LOGIN_ALLOWLIST` com valores exatos. Jarvis aceita os cabeçalhos `Tailscale-User-*` apenas quando essa confiança está explicitamente ligada, o host HTTPS coincide e o login está na allowlist.

## Operação

O perfil limita Hermes a 4,5 GB, divide Jarvis entre `jarvis-web` e `jarvis-worker` com 1 GB cada e limita OmniRoute a 1,5 GB. Trabalho adicional deve aguardar na fila. `jarvis-web` publica somente `127.0.0.1:3000`; `jarvis-worker`, Hermes e OmniRoute ficam apenas na rede Compose.

Backup diário: `RESTIC_REPOSITORY=... RESTIC_PASSWORD_FILE=... scripts/backup-oci.sh`. O script registra serviços ativos, para-os, cria snapshot, faz restore temporário, valida estrutura e parte dos dados, e reinicia somente o conjunto anterior mesmo após falha. Restore manual nunca sobrescreve estado ativo: `scripts/restore-oci.sh`, revisar `/srv/jarvis/restore/<data>` e só então trocar diretórios.

Para uma VPS de 4 vCPU/8 GB, carregue `.env.standard-4x8.example` e use `--profile standard-4x8`; a mesma composição preserva os limites de cada perfil.

Clientes, pareamento e workspace: [`clients-workspace.md`](clients-workspace.md).

## Recriar após perda

Reaplicar OpenTofu na região home, montar o disco em `/srv/jarvis`, reinstalar Compose com os mesmos digests, restaurar dados em staging, validar testes de contrato/ARM64 e iniciar. Falha de capacidade A1 é bloqueio operacional, não autorização para recurso pago.
