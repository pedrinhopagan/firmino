# Código

Todo agente que escrever ou alterar código deve usar o Skill tool com name `code-practices` e o Skill tool com name `codebase-design` antes de agir. As duas chamadas são obrigatórias mesmo em mudanças pequenas.

# Arquitetura

O Kolega tem três processos. O Main do Electron cuida só da janela e do ciclo de vida do Engine. O Engine, um binário Bun compilado em `dist-engine/`, é dono de todo o estado e serve um router oRPC em loopback, protegido pelo token que o Main gera a cada execução. O Renderer fala apenas com o Engine, por esse router, e importa de `src/shared` só tipos.

O Kolega deriva do Mimo (`/mnt/data/Projects/mimo`). Antes de escrever um módulo que o Mimo já tem, leia a versão de lá e copie só o comportamento que o Kolega usa.

# Execução

Shells abertos pelo T3 Code herdam `ELECTRON_RUN_AS_NODE=1`, que faz o Electron rodar como Node e quebrar no import de `electron`. Rode o app com `env -u ELECTRON_RUN_AS_NODE bun run dev`.

O modo dev guarda os dados em `~/.config/kolega-dev` e expõe o Chromium para automação em `127.0.0.1:9250`. Os spans de desempenho ficam em `logs/observations.jsonl` dentro dessa pasta.

Meça a memória pelo PSS de `/proc/<pid>/smaps_rollup`. A soma do RSS conta várias vezes a memória que os processos do Chromium compartilham.
