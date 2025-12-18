contracts=(
    asset-transit-desk
    balance-freezer
    balance-tracker
    capybara-finance
    capybara-finance-v2
    card-payment-processor
    card-payment-processor-v2
    cashier
    credit-agent
    multisig
    net-yield-distributor
    periphery
    shared-wallet-controller
    treasury
)
# for remote in "${remotes[@]}"; do
#     git remote add $remote git@github.com:cloudwalk/brlc-$remote.git
#     git fetch $remote
# done

for contract in "${contracts[@]}"; do
  rm -rf contracts/$contract/.cursor
  rm -rf contracts/$contract/.github
  rm -rf contracts/$contract/.husky
  rm -rf contracts/$contract/eslint.config.js
  rm -rf contracts/$contract/package-lock.json
done;