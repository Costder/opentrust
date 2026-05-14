#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -d ../opentrust-private ]; then
  git clone git@github.com:Costder/opentrust-private.git ../opentrust-private
fi
python -m pip install -e payment-contracts
echo "Install ../opentrust-private according to its private README and configure PAYMENT_PROVIDER."
