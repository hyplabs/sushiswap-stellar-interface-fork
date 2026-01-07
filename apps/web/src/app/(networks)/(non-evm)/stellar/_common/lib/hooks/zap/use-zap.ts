'use client'

import {
  createErrorToast,
  createInfoToast,
  createSuccessToast,
} from '@sushiswap/notifications'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addMinutes } from 'date-fns'
import { ChainId } from 'sushi'
import { calculateAmountOutMinimum } from '../../services/router-service'
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

      const amountToToken0 = amountInBigInt / 2n
      const amountToToken1 = amountInBigInt - amountToToken0 // Handle odd amounts

      const zapRouterClient = getZapRouterContractClient({
        contractId: contractAddresses.ZAP_ROUTER,
        publicKey: userAddress,
      })

      const token0ZapSwapParams = await getZapSwapParams({
        tokenIn,
        tokenOut: token0,
        amount: amountToToken0,
        slippage,
        service,
      })

      const token1ZapSwapParams = await getZapSwapParams({
        tokenIn,
        tokenOut: token1,
        amount: amountToToken1,
        slippage,
        service,
      })

      let assembledTransaction
      try {
        assembledTransaction = await zapRouterClient.zap_in(
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
              swap_amount_hint: undefined,
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
      } catch (simulationError) {
        console.error('Transaction simulation failed:', simulationError)
        throw new Error(
          `Transaction simulation failed: ${simulationError instanceof Error ? simulationError.message : String(simulationError)}`,
        )
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

const getZapSwapParams = async ({
  tokenIn,
  tokenOut,
  amount,
  slippage,
  service,
}: {
  tokenIn: Token
  tokenOut: Token
  amount: bigint
  slippage: number
  service: SushiStellarService
}): Promise<{
  path: string[]
  fees: number[]
  swapMinOut: bigint
}> => {
  if (tokenIn.contract === tokenOut.contract) {
    return {
      path: [],
      fees: [],
      swapMinOut: 0n,
    }
  }
  const route = await service.findBestRoute(tokenIn, tokenOut, amount)
  if (!route) {
    throw new Error(
      `No route found between ${tokenIn.code} and ${tokenOut.code}`,
    )
  }
  const swapMinOut = calculateAmountOutMinimum(route.amountOut, slippage)
  return {
    path: route.path.map((token) => token.contract),
    fees: route.fees,
    swapMinOut,
  }
}
