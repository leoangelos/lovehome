'use client'

import { useSyncExternalStore } from 'react'

/* Estado do menu lateral no mobile, compartilhado entre o header (o botão) e a
 * sidebar (a gaveta).
 *
 * Store de módulo, e não context: o layout do painel é server component, e
 * envolvê-lo num provider transformaria header e sidebar em filhos de um
 * client component — arrastando a árvore inteira para o cliente por causa de
 * um booleano.
 *
 * `useSyncExternalStore` porque é exatamente o caso dele: fonte externa ao
 * React, com snapshot de servidor (`false`) que evita erro de hidratação. */

let aberto = false
const assinantes = new Set<() => void>()

function assinar(fn: () => void) {
  assinantes.add(fn)
  return () => assinantes.delete(fn)
}

export function useMenuMovel(): boolean {
  return useSyncExternalStore(
    assinar,
    () => aberto,
    () => false
  )
}

export function alternarMenuMovel(valor?: boolean) {
  aberto = valor ?? !aberto
  assinantes.forEach((fn) => fn())
}
