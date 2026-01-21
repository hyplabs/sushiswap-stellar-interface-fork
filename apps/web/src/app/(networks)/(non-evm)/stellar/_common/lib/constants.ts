import { Networks } from '@stellar/stellar-sdk'

// SET THIS FLAG AS NEEDED - this change cascades to many areas of the codebase
export const IS_FUTURENET = false

export const RPC_URL = IS_FUTURENET
  ? 'https://rpc-futurenet.stellar.org'
  : 'https://mainnet.sorobanrpc.com'

export const NETWORK_PASSPHRASE = IS_FUTURENET
  ? Networks.FUTURENET
  : Networks.PUBLIC

export const HORIZON_URL = IS_FUTURENET
  ? 'https://horizon-futurenet.stellar.org'
  : 'https://horizon.stellar.lobstr.co'
