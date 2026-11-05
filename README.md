# Kolega

Kolega é um secretário pessoal que fica aberto no seu computador. Você conversa com um único agente, e ele cuida de agendamentos, WhatsApp, e-mail e navegador.

O agente roda pelo Codex ou pelo Claude Code já conectados no seu computador. O Kolega não guarda tokens desses fornecedores.

## Desenvolvimento

```bash
bun install
bun run dev
```

`bun run check` executa lint, typecheck e a busca de código morto. `bun run package:linux` gera o AppImage em `release/`.
