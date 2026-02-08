#!/usr/bin/env bash
#
# Bootstrap Terraform remote state backend.
# Run this ONCE to create the storage account for state files.
# After running, uncomment the backend block in infra/backend.tf
# and run: terraform init -migrate-state
#
set -euo pipefail

RESOURCE_GROUP="rg-screenshare-tfstate"
STORAGE_ACCOUNT="stscreensharetfstate"
CONTAINER="tfstate"
LOCATION="eastus"

echo "Creating resource group: $RESOURCE_GROUP"
az group create --name "$RESOURCE_GROUP" --location "$LOCATION" --output none

echo "Creating storage account: $STORAGE_ACCOUNT"
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --kind StorageV2 \
  --min-tls-version TLS1_2 \
  --allow-blob-public-access false \
  --output none

echo "Creating blob container: $CONTAINER"
az storage container create \
  --name "$CONTAINER" \
  --account-name "$STORAGE_ACCOUNT" \
  --auth-mode login \
  --output none

echo ""
echo "✅ Remote state backend created."
echo ""
echo "Next steps:"
echo "  1. Uncomment the backend block in infra/backend.tf"
echo "  2. Set the 'key' to your environment (e.g. dev.terraform.tfstate)"
echo "  3. Run: cd infra && terraform init -migrate-state"
