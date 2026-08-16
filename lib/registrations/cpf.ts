import { encryptSecret, hmacDeterministic } from '@/lib/crypto/encrypt'

/* CPF — normalizacao, validacao de digito verificador e as tres formas de
   armazenamento (PRD 6.2).

   Nada aqui loga o numero. Se precisar depurar, logue o cpf_last4. */

/** Remove tudo que nao for digito. '123.456.789-09' → '12345678909' */
export { normalizarCpf, cpfValido } from './cpf-formato'
import { normalizarCpf, cpfValido } from './cpf-formato'

export interface CpfArmazenavel {
  cpf_hash: string
  cpf_encrypted: string
  cpf_last4: string
}

/**
 * Converte um CPF nas tres colunas de `registrations`. Lanca se o CPF for
 * invalido — gravar cadastro com CPF que nao existe contamina a base que
 * sustenta contrato e cobranca.
 */
export function prepararCpf(entrada: string): CpfArmazenavel {
  const cpf = normalizarCpf(entrada)
  if (!cpfValido(cpf)) {
    throw new Error('CPF inválido')
  }

  return {
    cpf_hash: hmacDeterministic(cpf),
    cpf_encrypted: encryptSecret(cpf),
    cpf_last4: cpf.slice(-4),
  }
}

/** Chave de busca por CPF, sem gravar nada. */
export function hashCpf(entrada: string): string {
  return hmacDeterministic(normalizarCpf(entrada))
}
