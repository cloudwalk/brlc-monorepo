# Multi-signature Wallet

<p align="center">
  <img src="./docs/media/brlc-cover.png">
</p>

[![codecov](https://codecov.io/github/cloudwalk/brlc-multisig/branch/main/graph/badge.svg)](https://codecov.io/github/cloudwalk/brlc-multisig)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Branch Workflow](https://github.com/cloudwalk/brlc-multisig/actions/workflows/branch.yml/badge.svg?branch=main)](https://github.com/cloudwalk/brlc-multisig/actions/workflows/branch.yml)

The purpose of multi-signature wallets is to increase security by requiring multiple parties to agree on transactions before execution. Transactions can be executed only when confirmed by a predefined number of owners. The project provides two implementations:

- A standard non-upgradeable implementation (`MultiSigWallet.sol`)
- An upgradeable implementation (`MultiSigWalletUpgradeable.sol`) using the UUPS pattern

Key features:

- Configurable number of required approvals
- Transaction expiration time
- Comprehensive security measures

## Documentation

Functional requirements are described in the [documentation](docs/documentation.md).
Technical requirements are described in the NatSpec comments in the code.

## Security audit

Smart contracts are [audited](https://github.com/mixbytes/audits_public) by [MixBytes](https://mixbytes.io):

- [MD Report](https://github.com/mixbytes/audits_public/blob/master/CloudWalk/README.md)
- [PDF Report](https://github.com/mixbytes/audits_public/blob/master/CloudWalk/CloudWalk%20Multisig%20Wallet%20Audit%20Report.pdf)
- [PDF Report (local copy)](CloudWalk%20Multisig%20Wallet%20Audit%20Report.pdf)

NOTE: There have been some changes in the contracts since the last audit, but they are not related to the main logic.

## Project Setup

This repository is mirrored from the [BRLC monorepo](https://github.com/cloudwalk/brlc-monorepo).
All development happens in the monorepo.

Read [Documentation](https://github.com/cloudwalk/brlc-dev-ex/blob/main/docs/DEVELOPMENT.md).

## Licensing

This project is released under the MIT License, see [LICENSE](./LICENSE).
