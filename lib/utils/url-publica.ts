// ==========================================
// Ponto único para montar URL pública do app.
//
// Existe por causa de um detalhe que quebra em silêncio: `NEXT_PUBLIC_APP_URL`
// pode vir com barra no fim (`https://dominio.com/`), e `${base}/cadastro/x`
// vira `https://dominio.com//cadastro/x`. O link abre — a maioria dos servidores
// tolera —, mas aparece feio na mensagem do cliente, e alguma camada de cache
// ou redirect pode tratar como caminho diferente. Normalizar aqui resolve nos
// quatro lugares de uma vez.
// ==========================================

/** Base sem barra final. Em desenvolvimento cai em localhost. */
export function basePublica(): string {
  const bruta = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  return bruta.replace(/\/+$/, '')
}

/** `urlPublica('/imoveis/LH-1001')` → `https://dominio.com/imoveis/LH-1001` */
export function urlPublica(caminho: string): string {
  const limpo = caminho.startsWith('/') ? caminho : `/${caminho}`
  return `${basePublica()}${limpo}`
}

/** A página pública de um imóvel usa o código de referência, não o UUID. */
export function urlDoImovel(referenceCode: string): string {
  return urlPublica(`/imoveis/${referenceCode}`)
}
