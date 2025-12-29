import { useQuery } from '@tanstack/react-query'
import { useStellarWallet } from '~stellar/providers'
import { getXlmBalance } from '../../soroban/xlm-helpers'
import { formatTokenAmount } from '../../utils/format'

export const useXlmBalance = () => {
  const { connectedAddress } = useStellarWallet()

  return useQuery({
    queryKey: ['stellar', 'useXlmBalance', connectedAddress],
    queryFn: async () => {
      if (!connectedAddress) {
        return { balance: 0n, formattedBalance: '-' }
      }
      const balance = await getXlmBalance(connectedAddress)
      const formattedBalance = formatTokenAmount(balance, 7, 2)
      return { balance, formattedBalance }
    },
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    enabled: Boolean(connectedAddress),
  })
}
