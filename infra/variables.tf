# ─── Core ────────────────────────────────────────────────────────────────────

variable "subscription_id" {
  description = "Azure subscription ID"
  type        = string
}

variable "location" {
  description = "Azure region for all resources"
  type        = string
  default     = "eastus"
}

variable "pg_location" {
  description = "Azure region for PostgreSQL (may differ if primary region is restricted)"
  type        = string
  default     = "centralus"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "project" {
  description = "Project name — used as prefix for all resource names"
  type        = string
  default     = "screenshare"
}

# ─── PostgreSQL ──────────────────────────────────────────────────────────────

variable "pg_admin_username" {
  description = "PostgreSQL admin username"
  type        = string
  default     = "pgadmin"
}

# pg_admin_password is generated via random_password resource — no variable needed

variable "database_mode" {
  description = "Whether to create a new PostgreSQL instance or use an existing external one"
  type        = string
  default     = "create"

  validation {
    condition     = contains(["create", "existing"], var.database_mode)
    error_message = "Must be 'create' or 'existing'."
  }
}

variable "existing_database_url" {
  description = "Full DATABASE_URL for external PostgreSQL (required when database_mode = 'existing')"
  type        = string
  sensitive   = true
  default     = ""
}

# ─── Azure OpenAI ────────────────────────────────────────────────────────────

variable "azure_openai_endpoint" {
  description = "Azure OpenAI endpoint URL"
  type        = string
}

variable "azure_openai_deployment_vision" {
  description = "Azure OpenAI deployment name for vision model"
  type        = string
  default     = "gpt-5-mini"
}

# ─── Auth ────────────────────────────────────────────────────────────────────

variable "api_key" {
  description = "API key for authenticated endpoints (createProof). Empty = dev mode (no auth)."
  type        = string
  sensitive   = true
  default     = ""
}

# ─── CORS ────────────────────────────────────────────────────────────────────

variable "cors_extra_origins" {
  description = "Additional CORS origins beyond the SWA frontend (e.g. localhost for dev)"
  type        = list(string)
  default     = []
}

# ─── Application Insights ───────────────────────────────────────────────────

variable "appinsights_mode" {
  description = "Whether to create a new Application Insights instance or reuse an existing one"
  type        = string
  default     = "create"

  validation {
    condition     = contains(["create", "existing"], var.appinsights_mode)
    error_message = "Must be 'create' or 'existing'."
  }
}

variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID for new App Insights (required when appinsights_mode = 'create')"
  type        = string
  default     = ""
}

variable "existing_appinsights_connection_string" {
  description = "Connection string of existing App Insights (required when appinsights_mode = 'existing')"
  type        = string
  sensitive   = true
  default     = ""
}

# ─── Storage ─────────────────────────────────────────────────────────────────

variable "storage_account_name" {
  description = "Storage account name (globally unique, 3-24 chars, lowercase alphanumeric only)"
  type        = string
  default     = ""
  # When empty, auto-generates: st{project}{env}{suffix}
}

# ─── Key Vault RBAC ─────────────────────────────────────────────────────────

variable "kv_admin_object_id" {
  description = "Object ID of the user/principal that manages Key Vault secrets (gets Secrets Officer role)"
  type        = string
}
