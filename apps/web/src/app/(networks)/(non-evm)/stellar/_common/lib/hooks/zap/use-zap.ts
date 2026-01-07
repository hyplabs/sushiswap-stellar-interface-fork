'use client'

import * as StellarSdk from '@stellar/stellar-sdk'
import {
  createErrorToast,
  createInfoToast,
  createSuccessToast,
} from '@sushiswap/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addMinutes } from 'date-fns'
import { ChainId } from 'sushi'
import {
  type SushiStellarService,
  createSushiStellarService,
} from '../../services/sushi-stellar-service'
import { DEFAULT_TIMEOUT, contractAddresses } from '../../soroban'
import { getZapRouterContractClient } from '../../soroban/client'
import {
  type AssembledTransactionLike,
  signAuthEntriesAndGetXdr,
  submitViaRawRPC,
  waitForTransaction,
} from '../../soroban/rpc-transaction-helpers'
import type { Token } from '../../types/token.type'
import { extractErrorMessage } from '../../utils/error-helpers'
import { getStellarTxnLink } from '../../utils/stellarchain-helpers'

export interface UseZapParams {
  poolAddress: string
  tokenIn: Token
  amountIn: string
  tokenInDecimals: number
  token0: Token
  token1: Token
  tickLower: number
  tickUpper: number
  slippage?: number
  userAddress: string
  signTransaction: (xdr: string) => Promise<string>
  signAuthEntry: (entryPreimageXdr: string) => Promise<string>
}

/**
 * Calculate minimum value with slippage protection
 */
function applySlippage(amount: bigint, slippage: number): bigint {
  const slippageMultiplier = BigInt(Math.floor((1 - slippage) * 1_000_000))
  return (amount * slippageMultiplier) / 1_000_000n
}

export const useZap = () => {
  const service = createSushiStellarService()
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['stellar', 'zap'],
    onMutate: async (params: UseZapParams) => {
      const timestamp = Date.now()
      createInfoToast({
        summary: 'Adding Liquidity...',
        type: 'mint',
        account: params.userAddress,
        chainId: ChainId.STELLAR,
        groupTimestamp: timestamp,
        timestamp,
      })
    },
    mutationFn: async (params: UseZapParams) => {
      const {
        poolAddress,
        tokenIn,
        amountIn,
        tokenInDecimals,
        token0,
        token1,
        tickLower,
        tickUpper,
        slippage = 0.005,
        userAddress,
        signTransaction,
        signAuthEntry,
      } = params

      const amountInBigInt = BigInt(
        Math.floor(Number.parseFloat(amountIn) * 10 ** tokenInDecimals),
      )

      const zapRouterClient = getZapRouterContractClient({
        contractId: contractAddresses.ZAP_ROUTER,
        publicKey: userAddress,
      })

      // Step 1: Get the routing paths for each pool token
      // We don't use swapMinOut from these - just the paths and fees
      const token0ZapSwapParams = await getZapSwapParams({
        tokenIn,
        tokenOut: token0,
        service,
      })

      const token1ZapSwapParams = await getZapSwapParams({
        tokenIn,
        tokenOut: token1,
        service,
      })

      const assembledTransaction = await zapRouterClient.zap_in(
        {
          params: {
            amount0_min: 0n,
            amount1_min: 0n,
            amount_in: amountInBigInt,
            deadline: BigInt(
              Math.floor(addMinutes(new Date(), 5).valueOf() / 1000),
            ),
            fees_to_token0: token0ZapSwapParams.fees,
            fees_to_token1: token1ZapSwapParams.fees,
            min_liquidity: 0n,
            path_to_token0: token0ZapSwapParams.path,
            path_to_token1: token1ZapSwapParams.path,
            pool: poolAddress,
            recipient: userAddress,
            sender: userAddress,
            swap_amount_hint:
              tokenIn.contract.toLowerCase() === token0.contract.toLowerCase()
                ? amountToToken1
                : amountToToken0,
            swap_to_token0_min_out: token0ZapSwapParams.swapMinOut,
            swap_to_token1_min_out: token1ZapSwapParams.swapMinOut,
            tick_lower: tickLower,
            tick_upper: tickUpper,
            token_in: tokenIn.contract,
          },
        },
        {
          timeoutInSeconds: DEFAULT_TIMEOUT,
          fee: 100000,
          simulate: true, // Explicitly enable simulation to ensure footprint is properly set
        },
      )

      const simulationResult = assembledTransaction.simulation
      if (
        simulationResult &&
        StellarSdk.rpc.Api.isSimulationError(simulationResult)
      ) {
        throw new Error(extractErrorMessage(simulationResult.error))
      }

      // Sign auth entries for nested authorization (PM -> Pool -> Token transfers)
      // This is required because the user is not the direct invoker of pool.increase_liquidity
      const transactionXdr = await signAuthEntriesAndGetXdr(
        assembledTransaction as unknown as AssembledTransactionLike,
        userAddress,
        signAuthEntry,
      )

      // Sign the transaction envelope
      const signedXdr = await signTransaction(transactionXdr)

      // Submit the signed XDR directly via raw RPC
      const txHash = await submitViaRawRPC(signedXdr)

      // Wait for confirmation
      const result = await waitForTransaction(txHash)

      if (result.success) {
        return {
          txHash,
          userAddress,
        }
      } else {
        console.error('Transaction failed:', result.error)
        throw new Error(`Transaction failed: ${JSON.stringify(result.error)}`)
      }
    },
    onSuccess: ({ txHash, userAddress }) => {
      createSuccessToast({
        summary: 'Liquidity added successfully',
        type: 'mint',
        account: userAddress,
        chainId: ChainId.STELLAR,
        txHash: txHash,
        href: getStellarTxnLink(txHash),
        groupTimestamp: Date.now(),
        timestamp: Date.now(),
      })

      // Invalidate queries
      queryClient.invalidateQueries({
        queryKey: ['stellar', 'pool', 'balances'],
      })
      queryClient.invalidateQueries({ queryKey: ['stellar', 'pool', 'info'] })
      queryClient.invalidateQueries({ queryKey: ['stellar', 'positions'] })
      queryClient.invalidateQueries({ queryKey: ['stellar', 'position-pool'] })
    },
    onError: (error) => {
      console.error('Add liquidity failed:', error)
      const errorMessage = extractErrorMessage(error)
      createErrorToast(errorMessage, false)
    },
  })
}

/**
 * Get the swap routing parameters for a zap leg.
 * Returns the path and fees needed to swap from tokenIn to tokenOut.
 * If tokenIn === tokenOut, returns empty arrays (no swap needed).
 */
const getZapSwapParams = async ({
  tokenIn,
  tokenOut,
  service,
}: {
  tokenIn: Token
  tokenOut: Token
  service: SushiStellarService
}): Promise<{
  path: string[]
  fees: number[]
}> => {
  // If input token is the same as output token, no swap is needed
  if (tokenIn.contract === tokenOut.contract) {
    return {
      path: [],
      fees: [],
    }
  }

  // Find the best route from tokenIn to tokenOut
  // We use a small amount (1) just to find the route - the actual amount
  // will be determined by the contract based on optimal split
  const route = await service.findBestRoute(tokenIn, tokenOut, 1n)
  if (!route) {
    throw new Error(
      `No route found between ${tokenIn.code} and ${tokenOut.code}. ` +
        `Make sure there is liquidity for this token pair.`,
    )
  }

  return {
    path: route.path.map((token) => token.contract),
    fees: route.fees,
  }
}
