terraform {
  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 3.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "azurerm" {
  features {}
  subscription_id = "d07bc077-0510-4962-b8e6-13b8d52633ef"
}

# ─── Random suffix for globally unique names ────────────────────────────────
resource "random_string" "pg_suffix" {
  length  = 4
  special = false
  upper   = false
}

# ─── Resource Group ─────────────────────────────────────────────────────────
resource "azurerm_resource_group" "main" {
  name     = "rg-${var.project}-${var.environment}"
  location = var.location

  tags = {
    environment = var.environment
    project     = var.project
    managed_by  = "terraform"
  }
}

# ─── Azure Container Registry (Basic SKU ~$5/mo) ───────────────────────────
resource "azurerm_container_registry" "main" {
  name                = "acr${var.project}${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Basic"
  admin_enabled       = true

  tags = azurerm_resource_group.main.tags
}

# ─── App Service Plan (B1 Linux ~$13/mo — needed for WebSockets) ───────────
resource "azurerm_service_plan" "main" {
  name                = "asp-${var.project}-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "B1"

  tags = azurerm_resource_group.main.tags
}

# ─── App Service (Linux Docker container) ───────────────────────────────────
resource "azurerm_linux_web_app" "main" {
  name                = "app-${var.project}-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  service_plan_id     = azurerm_service_plan.main.id

  site_config {
    always_on = true

    application_stack {
      docker_image_name        = "screenshare-guide:latest"
      docker_registry_url      = "https://${azurerm_container_registry.main.login_server}"
      docker_registry_username = azurerm_container_registry.main.admin_username
      docker_registry_password = azurerm_container_registry.main.admin_password
    }

    websockets_enabled = true
  }

  app_settings = {
    "WEBSITES_ENABLE_APP_SERVICE_STORAGE" = "false"
    "DOCKER_ENABLE_CI"                    = "true"
    "PORT"                                = "3001"
    "NODE_ENV"                            = "production"
    "DATABASE_URL"                        = "postgresql://${var.pg_admin_username}:${var.pg_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/screenshare?sslmode=require"
    "AZURE_STORAGE_CONNECTION_STRING"     = azurerm_storage_account.main.primary_connection_string
    "AZURE_STORAGE_CONTAINER"             = azurerm_storage_container.recordings.name
  }

  tags = azurerm_resource_group.main.tags
}

# ─── PostgreSQL Flexible Server (Burstable B1ms ~$12/mo) ───────────────────
resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "pg-${var.project}-${var.environment}-${random_string.pg_suffix.result}"
  resource_group_name    = azurerm_resource_group.main.name
  location               = var.pg_location
  version                = "16"
  administrator_login    = var.pg_admin_username
  administrator_password = var.pg_admin_password
  storage_mb             = 32768
  sku_name               = "B_Standard_B1ms"
  zone                   = "1"

  tags = azurerm_resource_group.main.tags
}

# Allow Azure services to connect to Postgres
resource "azurerm_postgresql_flexible_server_firewall_rule" "allow_azure" {
  name             = "AllowAzureServices"
  server_id        = azurerm_postgresql_flexible_server.main.id
  start_ip_address = "0.0.0.0"
  end_ip_address   = "0.0.0.0"
}

# Create the screenshare database
resource "azurerm_postgresql_flexible_server_database" "main" {
  name      = "screenshare"
  server_id = azurerm_postgresql_flexible_server.main.id
  charset   = "UTF8"
  collation = "en_US.utf8"
}

# ─── Storage Account (Standard LRS — cheapest) ─────────────────────────────
resource "azurerm_storage_account" "main" {
  name                     = "stscreensharedevwmem"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_storage_container" "recordings" {
  name                  = "screenshare-recordings"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}
