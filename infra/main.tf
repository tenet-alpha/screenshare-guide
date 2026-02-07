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

data "azurerm_client_config" "current" {}

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

  identity {
    type = "SystemAssigned"
  }

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
    # ── Platform ──
    "WEBSITES_ENABLE_APP_SERVICE_STORAGE" = "false"
    "DOCKER_ENABLE_CI"                    = "true"

    # ── App Config (defaults) ──
    "PORT"                           = "3001"
    "NODE_ENV"                       = "production"
    "CORS_ORIGIN"                    = "https://${azurerm_static_web_app.frontend.default_host_name}"
    "LOG_LEVEL"                      = "info"
    "VISION_PROVIDER"                = "azure"
    "TTS_PROVIDER"                   = "azure"
    "AZURE_OPENAI_ENDPOINT"          = var.azure_openai_endpoint
    "AZURE_OPENAI_DEPLOYMENT_VISION" = "gpt-5-mini"
    "ELEVENLABS_VOICE_ID"            = "21m00Tcm4TlvDq8ikWAM"
    "ELEVENLABS_MODEL_ID"            = "eleven_turbo_v2_5"
    "AZURE_SPEECH_ENDPOINT"          = var.azure_speech_endpoint
    "AZURE_SPEECH_VOICE_NAME"        = "en-US-JennyNeural"
    "AZURE_STORAGE_CONTAINER_NAME"   = azurerm_storage_container.recordings.name

    # ── Infra secrets (from Terraform state, not user-managed) ──
    "DATABASE_URL"                   = "postgresql://${var.pg_admin_username}:${var.pg_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/screenshare?sslmode=require"
    "AZURE_STORAGE_CONNECTION_STRING" = azurerm_storage_account.main.primary_connection_string

    # ── API Key secrets (Key Vault references — you set values manually) ──
    "AZURE_OPENAI_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.secrets["AZURE-OPENAI-API-KEY"].versionless_id})"
    "ELEVENLABS_API_KEY"   = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.secrets["ELEVENLABS-API-KEY"].versionless_id})"
    "ANTHROPIC_API_KEY"    = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.secrets["ANTHROPIC-API-KEY"].versionless_id})"
    "AZURE_SPEECH_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.secrets["AZURE-SPEECH-API-KEY"].versionless_id})"
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

# ─── Key Vault ──────────────────────────────────────────────────────────────
resource "azurerm_key_vault" "main" {
  name                       = "kv-${var.project}-${var.environment}"
  location                   = azurerm_resource_group.main.location
  resource_group_name        = azurerm_resource_group.main.name
  tenant_id                  = data.azurerm_client_config.current.tenant_id
  sku_name                   = "standard"
  soft_delete_retention_days = 7
  purge_protection_enabled   = false
  enable_rbac_authorization  = true

  tags = azurerm_resource_group.main.tags

  # NOTE: Role assignments managed manually (Contributor can't create them).
  # See commands in infra/README.md
}

# Secret placeholders — you set real values via az CLI or Portal
# lifecycle ignore_changes prevents Terraform from overwriting your manual values
locals {
  secret_names = [
    "AZURE-OPENAI-API-KEY",
    "ELEVENLABS-API-KEY",
    "ANTHROPIC-API-KEY",
    "AZURE-SPEECH-API-KEY",
  ]
}

# ─── Static Web App (Free tier — frontend) ──────────────────────────────────
resource "azurerm_static_web_app" "frontend" {
  name                = "swa-${var.project}-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = "eastus2"
  sku_tier            = "Free"
  sku_size            = "Free"

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_key_vault_secret" "secrets" {
  for_each     = toset(local.secret_names)
  name         = each.value
  value        = "PLACEHOLDER"
  key_vault_id = azurerm_key_vault.main.id

  lifecycle {
    ignore_changes = [value]
  }
}
