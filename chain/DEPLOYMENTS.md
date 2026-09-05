# RhodiumPay deployments

Both live, from the same unmodified `contracts/RhodiumPay.sol`.

| Network | Chain id | Contract | USDC | Explorer |
|---|---|---|---|---|
| **Arbitrum One** (production) | `42161` | `0x80cD8120170c799501E9a7eA0da4203AD52C1d7d` | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` | [arbiscan](https://arbiscan.io/address/0x80cD8120170c799501E9a7eA0da4203AD52C1d7d) |
| **Arbitrum Sepolia** (testing) | `421614` | `0x34b17673E4Be07D5027cF02C63b3bDf5ed7e13b2` | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` | [sepolia.arbiscan](https://sepolia.arbiscan.io/address/0x34b17673E4Be07D5027cF02C63b3bDf5ed7e13b2) |

Deployer: `0x2f85930757A742A480AC1196fcD42a952077968a`

Both USDC addresses were verified on their own chain — `symbol() == "USDC"`,
`decimals() == 6` — rather than copied from a list. On mainnet the token is
Circle's **native** USDC, not the bridged `USDC.e` at `0xFF970A61…`, which also
reports `symbol USDC` and would look correct while being the wrong asset.

## Which one to run

Mainnet is the code default, so a deploy that sets nothing settles real USDC.
Testing on Sepolia is therefore an explicit opt-in — four variables that must
move together:

```
EVM_CHAIN_ID=421614
EVM_CHAIN_NAME=Arbitrum Sepolia
EVM_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
EVM_CONTRACT_ADDRESS=0x34b17673E4Be07D5027cF02C63b3bDf5ed7e13b2
EVM_TOKEN_ADDRESS=0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d
```

Changing some but not all is the failure worth guarding against: a mainnet
chain id with a testnet contract address gives a checkout that looks correct
and settles nothing, because the contract simply is not there. `EVM_CONTRACT_ADDRESS`
has no default for exactly this reason — it has to be stated deliberately.

## Proving the flow before mainnet

The point of the Sepolia contract is to watch one real USDC transfer land in a
merchant's wallet:

1. Point the four variables above at Sepolia
2. Fund a test buyer with Sepolia USDC (a faucet, or transfer from the deployer)
3. Onboard a merchant, so an EVM wallet is minted for her
4. Buy something from her storefront and pay on-chain
5. Confirm on [sepolia.arbiscan](https://sepolia.arbiscan.io) that the USDC
   moved **buyer → merchant**, not buyer → Rhodium, and that the naira ledger
   shows exactly one entry

Only then switch back to mainnet. Nothing here has moved a real token yet: the
rail is covered by tests against a mock chain, which proves the logic and
proves nothing about the chain.

## Redeploying

```bash
ARBITRUM_CHAIN_ID=421614 npm run contracts:deploy:arbitrum   # Sepolia
ARBITRUM_CHAIN_ID=42161  npm run contracts:deploy:arbitrum   # mainnet
```

Add `--estimate` to price it and send nothing. Mainnet cost was about
0.0000118 ETH; Sepolia was ten times that, because testnet gas prices are not
calibrated to anything real.
