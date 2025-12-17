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
   - [ ] asset-transit-desk
   - [ ] balance-freezer
   - [ ] balance-tracker
   - [x] blueprint
   - [ ] capybara-finance
   - [ ] capybara-finance-v2
   - [ ] card-payment-processor
   - [ ] card-payment-processor-v2
   - [ ] cashier
   - [ ] credit-agent
   - [ ] multisig
   - [ ] net-yield-distributor
   - [ ] periphery
   - [ ] shared-wallet-controller
   - [x] token
   - [ ] treasury

### Monorepo

#### Tasks

- [x] Setup components codecov
- [ ] Setup common precommit hooks and linting
- [x] Create CI to sync contracts from monorepo to legacy repos
- [x] Create CI to use in monorepo instead

#### Monorepo migration roadmap

- [ ] Move all contracts to the monorepo
- [ ] Configure github repo with right permissions and rules
- [ ] Change readmes to use monorepo links
  - Codecov badges to use component name
  - Project setup documentation to use monorepo links
  - License to use monorepo links
- [ ] Migrate Stratus to the monorepo contracts
- [ ] Join contracts by workspace and cross-reference contracts
- [ ] Extract common contracts to a separate packages

#### Monorepo migration checklist

- Remove from repo some folders and files:
  - .github
  - .cursor
  - lint configs
