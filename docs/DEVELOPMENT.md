## Cloudwalk Solidity Project Setup

## Play with repo

1. Clone the repo.
1. [Setup npm token](./NPM.md).
1. Install dependencies:
   ```sh
   pnpm install
   ```
1. `CD` into the contract you want to work on.
1. Optional: Create the `.env` file based on the `.env.example` one:
   - Windows:

   ```sh
   copy .env.example .env
   ```

   - MacOS/Linux:

   ```sh
   cp .env.example .env
   ```

1. Optionally update the settings in the newly created `.env` file (e.g., Solidity version, number of optimization runs, network RPC URLs, private keys (PK) for networks, etc.).

## Build and test

```sh
# Compile all contracts
pnpm run build

# Run all tests
pnpm run test
```

1. You can also run tests in all contracts with:
   ```sh
   pnpm run -r test # in monorepo root
   ```
