import { useQuery } from '@tanstack/react-query'
import type { Token } from '../../types/token.type'
import { usePoolInfo } from '../pool'
import { usePoolPriceUsd } from '../pool/use-pool-price-usd'

type UsePoolOwnershipProps = {
  pairAddress: string
  token0: Token
  token1: Token
  reserve0: bigint
  reserve1: bigint
}

export const usePoolOwnership = ({
  pairAddress,
  token0,
  token1,
  reserve0,
  reserve1,
}: UsePoolOwnershipProps) => {
  const { data: pool, isPending: isPendingPoolInfo } = usePoolInfo(
    pairAddress ?? null,
  )
  const { data: poolPriceUsd, isPending: isPendingPoolPriceUsd } =
    usePoolPriceUsd({
      token0,
      token1,
      pairAddress,
    })
  return useQuery({
    queryKey: [
      'stellar',
      'usePoolOwnership',
      {
        pool: pool?.address,
        reserve0: reserve0.toString(),
        reserve1: reserve1.toString(),
        poolPriceUsd,
      },
    ],
    queryFn: async () => {
      if (!pairAddress || !pool || !poolPriceUsd) {
        return { ownership: '0', ownedSupplyUsd: '0' }
      }

      const poolUsdValueOwned =
        (poolPriceUsd.token0Price * Number(reserve0)) / 10 ** token0.decimals +
        (poolPriceUsd.token1Price * Number(reserve1)) / 10 ** token1.decimals

      const totalPoolUsdValue =
        (poolPriceUsd.token0Price * Number(pool.reserves.token0.amount)) /
          10 ** token0.decimals +
        (poolPriceUsd.token1Price * Number(pool.reserves.token1.amount)) /
          10 ** token1.decimals

      const proportionToken0Owned =
        Number(reserve0) / Number(pool.reserves.token0.amount)
      const proportionToken1Owned =
        Number(reserve1) / Number(pool.reserves.token1.amount)

      const ownership =
        totalPoolUsdValue === 0
          ? ((proportionToken0Owned + proportionToken1Owned) / 2).toString()
          : (poolUsdValueOwned / totalPoolUsdValue).toString()

      return { ownership, ownedSupplyUsd: poolUsdValueOwned.toString() }
    },
    enabled: !isPendingPoolInfo && !isPendingPoolPriceUsd,
  })
}
