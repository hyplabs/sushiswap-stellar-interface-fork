import { useQuery } from '@tanstack/react-query'
import { useStablePrice } from '~stellar/_common/lib/hooks/price/use-stable-price'
import type { Token } from '~stellar/_common/lib/types/token.type'
import { useTopPools } from './use-top-pools'

export const usePoolPriceUsd = ({
  token0,
  token1,
  pairAddress,
}: {
  token0: Token
  token1: Token
  pairAddress: string
}) => {
  const { data: topPools, isPending: isPendingTopPools } = useTopPools()
  const topPool = topPools?.find(
    (pool) => pool.address.toLowerCase() === pairAddress.toLowerCase(),
  )
  const { data: token0PriceFromStableQuote, isPending: isPendingToken0Price } =
    useStablePrice({
      token: token0,
      enabled: !isPendingTopPools && topPool === undefined,
    })
  const { data: token1PriceFromStableQuote, isPending: isPendingToken1Price } =
    useStablePrice({
      token: token1,
      enabled: !isPendingTopPools && topPool === undefined,
    })
  const token0Price = topPool
    ? topPool.token0PriceUSD
    : Number(token0PriceFromStableQuote ?? '0')
  const token1Price = topPool
    ? topPool.token1PriceUSD
    : Number(token1PriceFromStableQuote ?? '0')
  return useQuery({
    queryKey: [
      'stellar',
      'usePoolPriceUsd',
      token0,
      token1,
      token0Price,
      token1Price,
    ],
    queryFn: async () => {
      return { token0Price, token1Price }
    },
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    enabled: !!topPool || (!isPendingToken0Price && !isPendingToken1Price),
  })
}
