# Firmino

Firmino é um secretário pessoal que fica aberto no seu computador. Você conversa com um único agente, e ele cuida de agendamentos, WhatsApp, e-mail e navegador.

O agente roda pelo Codex ou pelo Claude Code já conectados no seu computador. O Firmino não guarda tokens desses fornecedores.

## Desenvolvimento

```bash
bun install
bun run dev
```

`bun run check` executa lint, typecheck e a busca de código morto. `bun run package:linux` gera o AppImage em `release/`.

`bun run install:linux` gera o AppImage e o instala em `~/.local/bin/firmino`, com entrada no menu e início com o sistema na bandeja. Rode de novo para atualizar.
