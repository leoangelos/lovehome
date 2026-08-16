// ==========================================
// CPF — normalização e dígito verificador. SEM DEPENDÊNCIA NENHUMA.
//
// Separado de cpf.ts porque o formulário público valida o CPF enquanto a pessoa
// digita, e isso é código de navegador. `cpf.ts` importa lib/crypto/encrypt
// para as funções de armazenamento (hash e cifra); arrastar `crypto` do Node
// para o bundle só para chamar `cpfValido` é peso e risco à toa.
//
// Aqui não há segredo e não há chave: são contas sobre 11 dígitos.
// ==========================================

export function normalizarCpf(entrada: string): string {
  return String(entrada).replace(/\D/g, '')
}

/**
 * Valida os dois digitos verificadores.
 *
 * Rejeita tambem as sequencias de digito repetido ('11111111111'): elas passam
 * na conta do modulo 11 mas nao sao CPF valido, e sao exatamente o que alguem
 * digita para testar o formulario.
 */
export function cpfValido(entrada: string): boolean {
  const cpf = normalizarCpf(entrada)
  if (cpf.length !== 11) return false
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digito = (ateIndice: number): number => {
    let soma = 0
    let peso = ateIndice + 1
    for (let i = 0; i < ateIndice; i++) {
      soma += Number(cpf[i]) * peso--
    }
    const resto = (soma * 10) % 11
    return resto === 10 ? 0 : resto
  }

  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10])
}
