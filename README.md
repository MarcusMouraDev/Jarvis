# Jarvis

Jarvis V23 — presença viva. Interface web com globo neural WebGL reativo a estado, áudio e ponteiro, sobre Next.js 16 + React Three Fiber.

## Stack

- Next.js 16 / React 19.2
- `@react-three/fiber` v9 + three
- Tailwind v4 (OKLCH)
- Web Audio API
- Vitest

## Desenvolvimento

### Ativação (terminal)

Modo canônico — sobe OmniRoute + Hermes + Jarvis e abre a UI:

```bash
jarvis inti
```

Primeira vez, instale o comando no PATH:

```bash
npm run jarvis:install-cli   # symlink em ~/.local/bin/jarvis
```

Equivalente dentro do repo: `npm run inti` ou `npm run up`.

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm install
cp .env.example .env.local   # preencha GEMINI_API_KEY e/ou CURSOR_API_KEY
npm run skills:sync          # espelha skills do Cursor em .cursor/skills
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

### Desktop (Electron)

```bash
npm run desktop       # OmniRoute sidecar headless + janela Jarvis
npm run desktop:dev   # idem, Next do Jarvis em turbopack
```

OmniRoute sobe com `serve --no-open` (não `npm run dev`). Relatórios de uso ficam no chip `omni` da barra. Dashboard OmniRoute só pelo menu da bandeja.

### Atalhos

| Atalho | Ação |
|--------|------|
| `⌘/Ctrl+K` | Paleta de comandos (skills, modelos, terminal) |
| `⌘/Ctrl+H` | Histórico / execuções |
| `⌘/Ctrl+V` | Alternar voz |
| `⌘/Ctrl+L` | Alternar ouvir |
| `Esc` | Cancelar |
| `/run <cmd>` ou `!<cmd>` | Terminal com política |

### Provedores

| Alias | Env | Integração |
|-------|-----|------------|
| `gemini` | `GEMINI_API_KEY` | Google Generative Language API (SSE) |
| `codex` | `CURSOR_API_KEY` | Cursor SDK (`@cursor/sdk`) |
| `deepseek-*` | — | mock até adapter real |

Sem chave configurada, o alias cai no mock (visível na rota `mode: mock`).

### Skills

- `GET /api/skills` — catálogo (skills-cursor + pessoais + projeto)
- `/skills list`, `/skill use <nome>`, `/skill show <nome>`, `/skill clear`
- Skills selecionadas entram no system prompt do Gemini / Cursor

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run up` | Sobe sidecars e abre UI (igual `jarvis inti`) |
| `npm run inti` | Ativação canônica via CLI local |
| `npm run jarvis:install-cli` | Instala `jarvis` em `~/.local/bin` |
| `npm run build` | Build de produção |
| `npm run build:vps` | Build VPS Safe Core; valida que Electron não entra no standalone |
| `npm run build:desktop` | Build interno desktop/legado, incluindo Electron |
| `npm run lint` | ESLint (flat config Next 16) |
| `npm run typecheck` | TypeScript sem emit |
| `npm test` | Suite Vitest |
| `npm run test:e2e` | Playwright (Chromium) |
| `npm run skills:sync` | Espelha skills Cursor no projeto |
| `npm start` | Serve o build |

## Estados da presença

| Estado | Leitura |
|--------|---------|
| idle | Neutro frio |
| listening | Azul — microfone |
| thinking | Laranja — computação |
| speaking | Ciano — voz de saída |
| asking | Vermelho — precisa de você |
| failure | Sem cor nova — perde coerência |

Configuração de modelos: `config/models.yaml`. Sistema visual: `DESIGN.md`. Arquitetura, segurança e evolução: [`docs/`](docs/README.md).

## VPS OCI

Deploy adaptável para Oracle Always Free A1 (ARM64) e VPS 4x8: [`docs/deploy/oci-a1-free.md`](docs/deploy/oci-a1-free.md). Compose separa `jarvis-web` em localhost de `jarvis-worker` privado, configura Hermes como `custom:jarvis-broker`, usa bind mounts sob `/srv/jarvis` e exige imagens fixadas por digest.

PWA privada, workspace versionado, Mac companion e Telegram: [`docs/deploy/clients-workspace.md`](docs/deploy/clients-workspace.md).

Regras Cursor importadas de `/Users/marcuspaulo/.cursor/plugins/cache`: `no-inline-imports`, `typescript-exhaustive-switch` e `mobbin-usage`. Fontes e classificação: [`docs/rules/cursor-import.md`](docs/rules/cursor-import.md).
