# Jarvis

Jarvis V21 — presença viva. Interface web com esfera WebGL reativa a estado e áudio, sobre Next.js 16 + React Three Fiber.

## Stack

- Next.js 16 / React 19.2
- `@react-three/fiber` v9 + three
- Tailwind v4 (OKLCH)
- Web Audio API
- Vitest

## Desenvolvimento

```bash
export PATH="/opt/homebrew/bin:$PATH"
npm install
cp .env.example .env.local   # preencha GEMINI_API_KEY e/ou CURSOR_API_KEY
npm run skills:sync          # espelha skills do Cursor em .cursor/skills
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

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
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm run lint` | ESLint (flat config Next 16) |
| `npm run typecheck` | TypeScript sem emit |
| `npm test` | Suite Vitest |
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

Configuração de modelos: `config/models.yaml`. Sistema visual: `DESIGN.md`.
