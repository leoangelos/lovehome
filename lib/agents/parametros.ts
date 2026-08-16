import { capacidadesDoModelo } from '@/lib/ui/rotulos'

/* ==========================================
   Parâmetros opcionais da chamada, por modelo.

   Ponto ÚNICO. Todo lugar que chama `chat.completions.create` com temperatura
   ou teto de tokens passa por aqui.

   Por que existe: os modelos não aceitam o mesmo payload, e a diferença não é
   cosmética — é 400 na requisição. Medido contra a API em `check:modelos`:

   - gpt-5 / -mini / -nano, o4-mini, o3-mini recusam `temperature` != 1,
     `max_tokens` e as penalidades.
   - gpt-5.1 aceita temperatura e penalidades, mas exige
     `max_completion_tokens` no lugar de `max_tokens`.
   - a família 4o/4.1 aceita tudo.

   Antes disto, `temperature` e `max_tokens` iam sempre. A tela de Agentes deixa
   escolher o modelo — então bastava alguém selecionar um da lista nova para o
   atendimento inteiro parar de responder, com o erro visível só no log.
   ========================================== */

export interface AjustesModelo {
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  frequency_penalty?: number | null
  presence_penalty?: number | null
}

export function montarParametros(modelo: string, ajustes: AjustesModelo): Record<string, unknown> {
  const cap = capacidadesDoModelo(modelo)
  const params: Record<string, unknown> = {}

  /* `temperature: 1` é o padrão desses modelos — mandar explicitamente também
     passa, mas omitir é mais seguro: a mensagem de erro da OpenAI reclama do
     VALOR, e um default nosso mudando no futuro voltaria a quebrar. */
  if (cap.aceitaTemperatura && ajustes.temperature !== null && ajustes.temperature !== undefined) {
    params.temperature = ajustes.temperature
  }

  if (cap.aceitaTemperatura && ajustes.top_p !== null && ajustes.top_p !== undefined) {
    params.top_p = ajustes.top_p
  }

  if (ajustes.max_tokens !== null && ajustes.max_tokens !== undefined) {
    /* Nos modelos de raciocínio o teto cobre também os tokens de pensamento:
       um valor apertado devolve resposta VAZIA em vez de erro, que é pior de
       diagnosticar. Por isso o dobro, com piso. */
    params[cap.tetoPorCompletion ? 'max_completion_tokens' : 'max_tokens'] = cap.raciocinio
      ? Math.max(ajustes.max_tokens * 2, 2000)
      : ajustes.max_tokens
  }

  if (cap.aceitaPenalidades) {
    if (ajustes.frequency_penalty !== null && ajustes.frequency_penalty !== undefined) {
      params.frequency_penalty = ajustes.frequency_penalty
    }
    if (ajustes.presence_penalty !== null && ajustes.presence_penalty !== undefined) {
      params.presence_penalty = ajustes.presence_penalty
    }
  }

  return params
}
