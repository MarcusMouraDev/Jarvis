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
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção |
| `npm test` | Suite Vitest |
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
