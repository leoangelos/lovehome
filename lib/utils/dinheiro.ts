/* Dinheiro digitado por gente → centavos, e de volta. Puro, sem dependência.

   A armadilha que isto fecha: um campo pré-preenchido com "820000.00" (ponto
   decimal, à americana) lido por um parser que trata ponto como separador de
   milhar vira R$ 82.000.000,00 — 8,2 bilhões de centavos, acima do INTEGER do
   Postgres, e o save falha com um erro genérico. Aqui os dois lados falam a
   mesma língua: o texto mostrado é pt-BR ("820.000,00") e o parser entende
   pt-BR, "820000", "820000,50" e o formato americano quando não há vírgula. */

/** Teto do INTEGER do Postgres — as colunas *_cents são INTEGER. */
export const MAX_CENTAVOS = 2_147_483_647

/** 82000000 → '820.000,00' (sem "R$", para caber num input). */
export function paraTextoReais(centavos: number | null | undefined): string {
  if (centavos == null) return ''
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * '820.000,00' | '820000,50' | '820000' | '820000.50' → centavos.
 * Vazio → null. Lixo → NaN (quem chama decide a mensagem).
 */
export function paraCentavos(texto: string): number | null {
  const limpo = texto.replace(/[R$\s]/g, '')
  if (!limpo) return null

  let normalizado = limpo
  if (limpo.includes(',')) {
    // pt-BR: ponto é milhar, vírgula é decimal.
    normalizado = limpo.replace(/\./g, '').replace(',', '.')
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
    // Só pontos em grupos de três: milhar ("1.250.000").
    normalizado = limpo.replace(/\./g, '')
  }
  // Caso restante ("820000.50", "820000"): ponto é decimal, como o JS espera.

  if (!/^\d+(\.\d+)?$/.test(normalizado)) return NaN
  return Math.round(Number(normalizado) * 100)
}
