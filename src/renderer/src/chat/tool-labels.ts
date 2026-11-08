interface ToolLabel {
  running: string
  done: string
}

function label(running: string, done: string): ToolLabel {
  return { running, done }
}

/**
 * What each tool does, as the work log says it: "Adicionando memória" while it runs, "Adicionou memória" once done.
 * Keyed by the tool's name without the MCP prefix, as both providers report it. A tool missing here shows its own name.
 */
export const toolLabels: Partial<Record<string, ToolLabel>> = {
  memory_note: label("Adicionando memória", "Adicionou memória"),
  memory_nap: label("Organizando memória", "Organizou memória"),
  memory_recall: label("Buscando na memória", "Buscou na memória"),
  memory_zoom: label("Detalhando memória", "Detalhou memória"),
  memory_forget: label("Esquecendo memória", "Esqueceu memória"),

  save_appointment: label("Salvando compromisso", "Salvou compromisso"),
  list_appointments: label("Vendo compromissos", "Viu compromissos"),
  complete_appointment: label("Concluindo compromisso", "Concluiu compromisso"),
  remove_appointment: label("Removendo compromisso", "Removeu compromisso"),

  save_routine: label("Salvando rotina", "Salvou rotina"),
  list_routines: label("Vendo rotinas", "Viu rotinas"),
  remove_routine: label("Removendo rotina", "Removeu rotina"),

  save_trigger: label("Salvando gatilho", "Salvou gatilho"),
  list_triggers: label("Vendo gatilhos", "Viu gatilhos"),
  remove_trigger: label("Removendo gatilho", "Removeu gatilho"),

  discord_chats: label("Vendo conversas do Discord", "Viu conversas do Discord"),
  discord_read: label("Lendo o Discord", "Leu o Discord"),
  discord_send: label("Enviando mensagem no Discord", "Enviou mensagem no Discord"),

  whatsapp_chats: label("Vendo conversas do WhatsApp", "Viu conversas do WhatsApp"),
  whatsapp_read: label("Lendo o WhatsApp", "Leu o WhatsApp"),
  whatsapp_send: label("Enviando mensagem no WhatsApp", "Enviou mensagem no WhatsApp"),

  calendar_events: label("Consultando a agenda", "Consultou a agenda"),
  calendar_create: label("Criando evento na agenda", "Criou evento na agenda"),
  calendar_update: label("Alterando evento da agenda", "Alterou evento da agenda"),
  calendar_delete: label("Apagando evento da agenda", "Apagou evento da agenda"),

  gmail_search: label("Buscando e-mails", "Buscou e-mails"),
  gmail_read_thread: label("Lendo e-mail", "Leu e-mail"),
  gmail_send: label("Enviando e-mail", "Enviou e-mail"),
  gmail_reply: label("Respondendo e-mail", "Respondeu e-mail"),
  gmail_create_draft: label("Escrevendo rascunho de e-mail", "Escreveu rascunho de e-mail"),
  gmail_archive: label("Arquivando e-mail", "Arquivou e-mail"),
  gmail_mark_read: label("Marcando e-mail como lido", "Marcou e-mail como lido"),
  gmail_trash: label("Movendo e-mail para a lixeira", "Moveu e-mail para a lixeira"),

  browser: label("Navegando na web", "Navegou na web"),
  screenshot: label("Tirando print do Firmino", "Tirou print do Firmino"),

  // Codex
  image_generation: label("Gerando imagem", "Gerou imagem"),

  // Claude Code
  Agent: label("Delegando a um subagente", "Delegou a um subagente"),
  Task: label("Delegando a um subagente", "Delegou a um subagente"),
  TodoWrite: label("Atualizando a lista de tarefas", "Atualizou a lista de tarefas"),
  ToolSearch: label("Carregando ferramentas", "Carregou ferramentas"),
  Skill: label("Carregando skill", "Carregou skill"),
  BashOutput: label("Lendo saída do comando", "Leu saída do comando"),
  TaskOutput: label("Lendo saída do comando", "Leu saída do comando"),
  Monitor: label("Acompanhando comando", "Acompanhou comando"),
  KillShell: label("Parando comando", "Parou comando"),
  KillBash: label("Parando comando", "Parou comando"),
  TaskStop: label("Parando comando", "Parou comando"),
  EnterPlanMode: label("Entrando no modo de plano", "Entrou no modo de plano"),
  ExitPlanMode: label("Apresentando plano", "Apresentou plano"),
  ListMcpResourcesTool: label("Listando recursos MCP", "Listou recursos MCP"),
  ReadMcpResourceTool: label("Lendo recurso MCP", "Leu recurso MCP"),
}
