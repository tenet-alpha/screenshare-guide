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
  subscription_id = var.subscription_id
}

data "azurerm_client_config" "current" {}

# ─── Locals ─────────────────────────────────────────────────────────────────

locals {
  # CORS: always include SWA frontend, plus any extras (localhost, app service URL, etc.)
  cors_origins = concat(
    ["https://${azurerm_static_web_app.frontend.default_host_name}"],
    var.cors_extra_origins,
  )
  cors_origin_string = join(",", local.cors_origins)

  # Application Insights: resolve connection string from either created or existing
  appinsights_connection_string = (
    var.appinsights_mode == "create"
    ? azurerm_application_insights.main[0].connection_string
    : var.existing_appinsights_connection_string
  )
}

# ─── Random suffix for globally unique names ────────────────────────────────
resource "random_string" "suffix" {
  length  = 4
  special = false
  upper   = false
}

# ─── Generated PostgreSQL admin password ────────────────────────────────────
resource "random_password" "pg_admin" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}|:?,."
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

# ACR webhook — triggers App Service redeploy on new image push
resource "azurerm_container_registry_webhook" "deploy" {
  name                = "deployToAppService"
  resource_group_name = azurerm_resource_group.main.name
  registry_name       = azurerm_container_registry.main.name
  location            = azurerm_resource_group.main.location
  actions             = ["push"]
  scope               = "screenshare-guide:latest"
  service_uri         = "https://${azurerm_linux_web_app.main.site_credential[0].name}:${azurerm_linux_web_app.main.site_credential[0].password}@${azurerm_linux_web_app.main.name}.scm.azurewebsites.net/api/registry/webhook"
  status              = "enabled"
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

    # ── App Config ──
    "PORT"                           = "3001"
    "NODE_ENV"                       = "production"
    "CORS_ORIGIN"                    = local.cors_origin_string
    "LOG_LEVEL"                      = "info"
    "VISION_PROVIDER"                = "azure"
    "TTS_PROVIDER"                   = "azure"

    # ── Azure OpenAI ──
    "AZURE_OPENAI_ENDPOINT"          = var.azure_openai_endpoint
    "AZURE_OPENAI_DEPLOYMENT_VISION" = var.azure_openai_deployment_vision

    # ── Azure Speech ──
    "AZURE_SPEECH_ENDPOINT"          = "https://${azurerm_resource_group.main.location}.tts.speech.microsoft.com"
    "AZURE_SPEECH_VOICE_NAME"        = "en-US-JennyNeural"

    # ── Storage ──
    "AZURE_STORAGE_CONTAINER"        = azurerm_storage_container.recordings.name

    # ── Telemetry ──
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = local.appinsights_connection_string

    # ── Auth ──
    "API_KEY" = var.api_key

    # ── Infra secrets (from Terraform state) ──
    "DATABASE_URL"                    = "postgresql://${var.pg_admin_username}:${random_password.pg_admin.result}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/screenshare?sslmode=require"
    "AZURE_STORAGE_CONNECTION_STRING" = azurerm_storage_account.main.primary_connection_string

    # ── API Key secrets (Key Vault references) ──
    "AZURE_OPENAI_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.secrets["AZURE-OPENAI-API-KEY"].versionless_id})"
    "ANTHROPIC_API_KEY"    = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.secrets["ANTHROPIC-API-KEY"].versionless_id})"
    "AZURE_SPEECH_API_KEY" = "@Microsoft.KeyVault(SecretUri=${azurerm_key_vault_secret.secrets["AZURE-SPEECH-API-KEY"].versionless_id})"
  }

  tags = azurerm_resource_group.main.tags
}

# ─── PostgreSQL Flexible Server (Burstable B1ms ~$12/mo) ───────────────────
resource "azurerm_postgresql_flexible_server" "main" {
  name                   = "pg-${var.project}-${var.environment}-${random_string.suffix.result}"
  resource_group_name    = azurerm_resource_group.main.name
  location               = var.pg_location
  version                = "16"
  administrator_login    = var.pg_admin_username
  administrator_password = random_password.pg_admin.result
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
  name                     = var.storage_account_name != "" ? var.storage_account_name : "st${var.project}${var.environment}${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"

  blob_properties {
    cors_rule {
      allowed_origins    = local.cors_origins
      allowed_methods    = ["PUT"]
      allowed_headers    = ["x-ms-blob-type", "Content-Type"]
      exposed_headers    = [""]
      max_age_in_seconds = 3600
    }
  }

  tags = azurerm_resource_group.main.tags
}

resource "azurerm_storage_container" "recordings" {
  name                  = "recordings"
  storage_account_name  = azurerm_storage_account.main.name
  container_access_type = "private"
}

# ─── Azure Speech Services (F0 free tier — 500K chars/mo) ───────────────────
resource "azurerm_cognitive_account" "speech" {
  name                = "speech-${var.project}-${var.environment}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  kind                = "SpeechServices"
  sku_name            = "F0"

  tags = azurerm_resource_group.main.tags
}

# ─── Application Insights (configurable: create new or reuse existing) ──────
resource "azurerm_application_insights" "main" {
  count               = var.appinsights_mode == "create" ? 1 : 0
  name                = "ai-${var.project}-${var.environment}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
  workspace_id        = var.log_analytics_workspace_id

  tags = azurerm_resource_group.main.tags
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
}

# RBAC: Admin user → Key Vault Secrets Officer (manage secrets via az CLI)
resource "azurerm_role_assignment" "kv_admin" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = var.kv_admin_object_id
}

# RBAC: App Service MSI → Key Vault Secrets User (read secrets at runtime)
resource "azurerm_role_assignment" "kv_app_reader" {
  scope                = azurerm_key_vault.main.id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_linux_web_app.main.identity[0].principal_id
}

# Secret placeholders — real values set via az CLI
# lifecycle ignore_changes prevents Terraform from overwriting manual values
locals {
  # These secrets are managed manually via az CLI — Terraform only creates placeholders
  secret_names = [
    "AZURE-OPENAI-API-KEY",
    "ANTHROPIC-API-KEY",
    "AZURE-SPEECH-API-KEY",
  ]
}

resource "azurerm_key_vault_secret" "secrets" {
  for_each     = toset(local.secret_names)
  name         = each.value
  value        = "PLACEHOLDER"
  key_vault_id = azurerm_key_vault.main.id

  lifecycle {
    ignore_changes = [value]
  }

  depends_on = [azurerm_role_assignment.kv_admin]
}

# Store the generated PG password in Key Vault (Terraform-managed, not manual)
resource "azurerm_key_vault_secret" "pg_admin_password" {
  name         = "PG-ADMIN-PASSWORD"
  value        = random_password.pg_admin.result
  key_vault_id = azurerm_key_vault.main.id

  depends_on = [azurerm_role_assignment.kv_admin]
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
