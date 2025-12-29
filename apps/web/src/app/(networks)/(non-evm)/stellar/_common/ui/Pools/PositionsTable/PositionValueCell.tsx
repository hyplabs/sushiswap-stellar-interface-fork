import { SkeletonText } from '@sushiswap/ui'
import { formatUSD } from 'sushi'
import { usePoolUsdValue } from '~stellar/_common/lib/hooks/pool/use-pool-price-usd'
import type { IPositionRowData } from './PositionsTable'

export const PositionValueCell = ({ data }: { data: IPositionRowData }) => {
  const { pool, token0, token1, principalToken0, principalToken1 } = data
  const {
    data: totalLPUsdValue,
    isLoading,
    isPending,
  } = usePoolUsdValue({
    token0,
    token1,
    reserve0: principalToken0,
    reserve1: principalToken1,
    pairAddress: pool,
  })

  if (isLoading || isPending || Number.isNaN(totalLPUsdValue)) {
    return <SkeletonText fontSize="lg" />
  }

  const poolTvl = totalLPUsdValue ?? 0

  return (
    <div className="flex items-center gap-1">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1 text-sm font-medium text-gray-900 dark:text-slate-50">
          {formatUSD(poolTvl)}
        </span>
      </div>
    </div>
  )
}
