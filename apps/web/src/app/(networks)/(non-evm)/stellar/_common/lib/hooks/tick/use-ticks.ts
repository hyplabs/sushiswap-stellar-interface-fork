'use client'

import { useQuery } from '@tanstack/react-query'
import ms from 'ms'
import type { PoolInfo } from '../../types/pool.type'
import { TICK_SPACINGS, type FeeTier, isFeeTier } from '../../utils/ticks'

export interface PopulatedTick {
  tickIdx: number
  liquidityNet: bigint
  liquidityGross: bigint
}

interface UseTicksProps {
  pool: PoolInfo | null | undefined
  numSurroundingTicks?: number
  enabled?: boolean
}

/**
 * Align tick to tick spacing
 */
const nearestUsableTick = (tick: number, tickSpacing: number): number => {
  return Math.round(tick / tickSpacing) * tickSpacing
}

/**
 * Mock tick data that simulates realistic liquidity positions.
 *
 * This creates ticks that mirror what you'd see from real positions:
 * - Position 1: +/- 1% of current price (tight range around current tick)
 * - Position 2: prices 1.5x to 2x (wider range above current price)
 * - Some additional scattered liquidity
 *
 * Each position creates TWO ticks:
 * - Lower tick: +liquidityNet (liquidity enters the range)
 * - Upper tick: -liquidityNet (liquidity exits the range)
 */
async function fetchMockTicks(
  pool: PoolInfo,
  _numSurroundingTicks: number,
): Promise<PopulatedTick[]> {
  const tickSpacing = isFeeTier(pool.fee)
    ? TICK_SPACINGS[pool.fee as FeeTier]
    : 60

  const currentTick = pool.tick
  const activeTick = nearestUsableTick(currentTick, tickSpacing)

  const mockTicks: PopulatedTick[] = []

  // Helper to add a position (creates lower and upper tick)
  const addPosition = (
    lowerTick: number,
    upperTick: number,
    liquidity: bigint,
  ) => {
    const alignedLower = nearestUsableTick(lowerTick, tickSpacing)
    const alignedUpper = nearestUsableTick(upperTick, tickSpacing)

    // Lower tick: liquidity enters (positive liquidityNet)
    mockTicks.push({
      tickIdx: alignedLower,
      liquidityNet: liquidity,
      liquidityGross: liquidity,
    })

    // Upper tick: liquidity exits (negative liquidityNet)
    mockTicks.push({
      tickIdx: alignedUpper,
      liquidityNet: -liquidity,
      liquidityGross: liquidity,
    })
  }

  // Base liquidity unit (scaled to pool's liquidity)
  const baseLiquidity = BigInt(pool.liquidity.amount) / 5n

  // Position 1: +/- 1% of current price
  // 1% price change ≈ ~100 ticks (since 1.0001^100 ≈ 1.01)
  // Using +/- 120 ticks to align with tick spacing of 60
  addPosition(
    activeTick - 120, // ~1% below current price
    activeTick + 120, // ~1% above current price
    baseLiquidity * 3n, // Main position, larger liquidity
  )

  // Position 2: prices 1.5x to 2x current
  // price = 1.0001^tick, so:
  // tick for 1.5x: ln(1.5) / ln(1.0001) ≈ 4055
  // tick for 2x: ln(2) / ln(1.0001) ≈ 6931
  // Align to tick spacing
  addPosition(
    activeTick + nearestUsableTick(4055, tickSpacing),
    activeTick + nearestUsableTick(6931, tickSpacing),
    baseLiquidity,
  )

  // Position 3: Some liquidity in a wider range (0.5x to 3x price)
  // tick for 0.5x: ln(0.5) / ln(1.0001) ≈ -6931
  // tick for 3x: ln(3) / ln(1.0001) ≈ 10986
  addPosition(
    activeTick + nearestUsableTick(-6931, tickSpacing),
    activeTick + nearestUsableTick(10986, tickSpacing),
    baseLiquidity / 2n,
  )

  // Position 4: Very tight position right at current price
  addPosition(
    activeTick - tickSpacing,
    activeTick + tickSpacing,
    baseLiquidity * 2n,
  )

  // Merge ticks at the same index (combine liquidityNet values)
  const tickMap = new Map<number, PopulatedTick>()
  for (const tick of mockTicks) {
    const existing = tickMap.get(tick.tickIdx)
    if (existing) {
      existing.liquidityNet = existing.liquidityNet + tick.liquidityNet
      existing.liquidityGross = existing.liquidityGross + tick.liquidityGross
    } else {
      tickMap.set(tick.tickIdx, { ...tick })
    }
  }

  // Convert back to array and sort
  const result = Array.from(tickMap.values())
    .filter((t) => t.liquidityNet !== 0n) // Remove ticks where liquidity cancels out
    .sort((a, b) => a.tickIdx - b.tickIdx)

  // Debug logging
  console.log('[useTicks] Generated mock ticks:', {
    currentTick,
    activeTick,
    tickSpacing,
    positions: [
      { name: 'Tight ±1%', lower: activeTick - 120, upper: activeTick + 120 },
      { name: 'Wide 1.5x-2x', lower: activeTick + 4055, upper: activeTick + 6931 },
      { name: 'Very wide 0.5x-3x', lower: activeTick - 6931, upper: activeTick + 10986 },
      { name: 'Current price ±1 spacing', lower: activeTick - tickSpacing, upper: activeTick + tickSpacing },
    ],
    ticks: result.map((t) => ({
      tick: t.tickIdx,
      liquidityNet: t.liquidityNet.toString(),
    })),
  })

  return result
}

/**
 * Hook to fetch tick data for a Stellar pool
 *
 * TODO: Replace mock implementation with actual contract calls
 * once TickLens is deployed. Example:
 *
 * ```ts
 * const poolLensClient = getPoolLensContractClient({
 *   contractId: contractAddresses.POOL_LENS,
 * })
 *
 * for (let i = minIndex; i <= maxIndex; i++) {
 *   const result = await poolLensClient.get_populated_ticks_in_word({
 *     pool: poolAddress,
 *     tick_bitmap_index: i,
 *   })
 *   ticks.push(...result.result)
 * }
 * ```
 */
export function useTicks({
  pool,
  numSurroundingTicks = 300,
  enabled = true,
}: UseTicksProps) {
  return useQuery({
    queryKey: [
      'stellar',
      'pool',
      'ticks',
      {
        poolAddress: pool?.address,
        tick: pool?.tick,
        numSurroundingTicks,
      },
    ],
    queryFn: async () => {
      if (!pool) {
        throw new Error('Pool is required')
      }

      // TODO: Replace with actual contract call
      return fetchMockTicks(pool, numSurroundingTicks)
    },
    enabled: Boolean(pool && enabled),
    staleTime: ms('30s'),
    refetchInterval: ms('60s'), // Less frequent refresh for mock data
  })
}
