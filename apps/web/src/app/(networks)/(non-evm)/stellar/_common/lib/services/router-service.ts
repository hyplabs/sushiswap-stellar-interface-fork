import type { PoolBasicInfo } from '../soroban/pool-helpers'
import type { Token } from '../types/token.type'

/**
 * Swap route information
 */
export interface SwapRoute {
  path: Token[]
  pools: PoolBasicInfo[]
  fees: number[]
  amountIn: bigint
  amountOut: bigint
  routeType: 'direct' | 'multihop'
}

/**
 * Format route for user display
 */
export function formatRouteForUser(route: SwapRoute): string {
  if (route.path.length === 2) {
    return `${route.path[0].code} → ${route.path[1].code}`
  } else {
    return route.path.map((t) => t.code).join(' → ')
  }
}

/**
 * Calculate minimum amount out with slippage protection
 */
export function calculateAmountOutMinimum(
  amountOut: bigint,
  slippage = 0.005,
): bigint {
  const slippageMultiplier = BigInt(Math.floor((1 - slippage) * 1000000))
  return (amountOut * slippageMultiplier) / BigInt(1000000)
}
