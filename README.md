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
   - [x] asset-transit-desk
   - [x] balance-freezer
   - [x] balance-tracker
   - [x] blueprint
   - [x] capybara-finance
   - [ ] capybara-finance-v2
   - [x] card-payment-processor
   - [x] card-payment-processor-v2
   - [x] cashier
   - [x] credit-agent
   - [x] multisig
   - [x] net-yield-distributor
   - [x] periphery
   - [x] shared-wallet-controller
   - [x] token
   - [x] treasury

### Monorepo

#### Tasks

- [x] Setup components codecov
- [x] Setup common precommit hooks and linting
- [x] Create CI to sync contracts from monorepo to legacy repos
- [x] Create CI to use in monorepo instead
- [x] Backstage files
- [x] Rename repository

#### Monorepo migration roadmap

- [x] Move all contracts to the monorepo
- [ ] Configure github repo with right permissions and rules
- [ ] Change readmes to use monorepo links
  - Codecov badges to use component name
  - Project setup documentation to use monorepo links
  - License to use monorepo links
- [ ] Migrate Stratus to the monorepo contracts
- [ ] Join contracts by workspace and cross-reference contracts
- [ ] Extract common contracts to a separate packages
- [ ] Use workspace defined versions for dependencies (hardhat, openzeppelin, etc.)
