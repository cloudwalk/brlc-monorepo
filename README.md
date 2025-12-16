# brlc-dev-ex
![brlc-cover](./docs/media/brlc-cover.png)
This repository contains utilities for smart contracts development

## Content
1. Common Development [documentation](./docs/DEVELOPMENT.md)
1. JS packages:
    - Package with [Prettier configuration](./packages/pretier-config)
    - Package with [Eslint configuration](./packages/eslint-config)
    - [@cloudwalk/chainshot](./packages/chainshot/README.md) library
1. Shared workflows to use in every Smart-contract repos
1. Smart-contracts:
    - [ ] brlc-asset-transit-desk
    - [ ] brlc-balance-freezer
    - [ ] brlc-balance-tracker
    - [ ] brlc-blueprint
    - [ ] brlc-capybara-finance
    - [ ] brlc-capybara-finance-v2
    - [ ] brlc-card-payment-processor
    - [ ] brlc-card-payment-processor-v2
    - [ ] brlc-cashier
    - [ ] brlc-credit-agent
    - [ ] brlc-multisig
    - [ ] brlc-net-yield-distributor
    - [ ] brlc-periphery
    - [ ] brlc-shared-wallet-controller
    - [ ] brlc-token
    - [ ] brlc-treasury

### Monorepo
#### Tasks
- [ ] Setup components codecov
- [ ] Setup common precommit hooks and linting
- [ ] Create CI to sync contracts from monorepo to legacy repos
- [ ] Create CI to use in monorepo instead

#### Monorepo migration roadmap
- [ ] Move all contracts to the monorepo
- [ ] Configure github repo with right permissions and rules
- [ ] Migrate Stratus to the monorepo contracts
- [ ] Join contracts by workspace and cross-reference contracts
- [ ] Extract common contracts to a separate packages

#### Monorepo migration checklist
- [ ] Remove from repo some folders and files:
    - .github
    - .cursor
    - lint configs
- [ ] Setup pnpm and test everything