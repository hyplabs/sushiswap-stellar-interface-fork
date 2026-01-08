import { useLocalStorage } from '@sushiswap/hooks'
import { useCallback, useMemo } from 'react'
import type { Token } from '../../types/token.type'

export function useCustomTokens() {
  const [value, setValue] = useLocalStorage<Record<string, Token>>(
    'sushi.customTokens.stellar',
    {},
  )

  const hydrate = useCallback((data: Record<string, Token>) => {
    return Object.entries(data).reduce<Record<string, Token>>(
      (acc, [k, token]) => {
        acc[k] = { ...token }
        return acc
      },
      {},
    )
  }, [])

  const addCustomToken = useCallback(
    (tokens: Token[]) => {
      // customTokenMutate('add', [currency])
      setValue((prev) => {
        return tokens.reduce(
          (acc, cur) => {
            // Make copy of cur to avoid mutation issues
            acc[cur.contract.toUpperCase()] = { ...cur }
            return acc
          },
          { ...prev },
        )
      })
    },
    [setValue],
  )

  const removeCustomToken = useCallback(
    (currency: Token) => {
      setValue((prev) => {
        return Object.entries(prev).reduce<Record<string, Token>>(
          (acc, cur) => {
            if (cur[0].toUpperCase() === `${currency.contract}`.toUpperCase()) {
              return acc // filter
            }
            acc[cur[0]] = cur[1] // add
            return acc
          },
          {},
        )
      })
    },
    [setValue],
  )

  const hasToken = useCallback(
    (currency: Token | string) => {
      if (typeof currency === 'string') {
        return Boolean(value[currency.toUpperCase()])
      }
      return Boolean(value[currency.contract.toUpperCase()])
    },
    [value],
  )

  const mutate = useCallback(
    (type: 'add' | 'remove', currency: Token[]) => {
      if (type === 'add') addCustomToken(currency)
      if (type === 'remove') removeCustomToken(currency[0])
    },
    [addCustomToken, removeCustomToken],
  )

  return useMemo(() => {
    return {
      data: hydrate(value),
      mutate,
      hasToken,
    }
  }, [hydrate, mutate, hasToken, value])
}
