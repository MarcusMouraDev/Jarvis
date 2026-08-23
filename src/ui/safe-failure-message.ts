const FAILURE_MESSAGES: Record<string, string> = {
  unavailable:
    "OmniRoute indisponível. Suba o sidecar em http://127.0.0.1:20128 e tente de novo.",
  local_model_unavailable:
    "Modelo local indisponível. Verifique se o OmniRoute está rodando.",
  model_unavailable: "Modelo não disponível neste momento.",
  authentication: "Falha de autenticação no provedor (verifique a API key).",
  invalid_request: "Pedido inválido para o provedor.",
  rate_limit: "Limite de taxa do provedor atingido. Aguarde e tente de novo.",
  timeout: "O provedor demorou demais para responder.",
  server_error: "Erro no servidor do provedor.",
  paid_provider_disabled:
    "Provedor pago bloqueado. Use @omniroute ou @cursor-text, ou confirme o uso pago.",
  budget_exceeded: "Orçamento do run excedido.",
  provider_incomplete: "Resposta incompleta do provedor.",
  sequence_gap: "Fluxo de eventos inconsistente. Recarregue a página.",
  protocol_error: "Erro de protocolo. Recarregue a página.",
};

export function explainSafeFailure(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return FAILURE_MESSAGES[reason] ?? `Falha: ${reason}`;
}
