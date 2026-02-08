# ─── Remote State Backend (Azure Storage) ────────────────────────────────────
#
# State is stored in a dedicated storage account + container.
# Bootstrap: run infra/bootstrap/init.sh once to create the storage account,
# then uncomment this block and run `terraform init -migrate-state`.
#
# terraform {
#   backend "azurerm" {
#     resource_group_name  = "rg-screenshare-tfstate"
#     storage_account_name = "stscreensharetfstate"
#     container_name       = "tfstate"
#     key                  = "dev.terraform.tfstate"
#   }
# }
