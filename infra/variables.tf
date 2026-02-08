variable "location" {
  description = "Azure region for all resources"
  default     = "eastus"
}

variable "pg_location" {
  description = "Azure region for PostgreSQL (may differ if primary region is restricted)"
  default     = "centralus"
}

variable "environment" {
  description = "Environment name"
  default     = "dev"
}

variable "project" {
  description = "Project name"
  default     = "screenshare"
}

variable "pg_admin_username" {
  description = "PostgreSQL admin username"
  default     = "pgadmin"
}

variable "pg_admin_password" {
  description = "PostgreSQL admin password"
  type        = string
  sensitive   = true
}

variable "azure_openai_endpoint" {
  description = "Azure OpenAI endpoint URL"
  type        = string
  default     = "https://dusan-mhyrnr7e-eastus2.cognitiveservices.azure.com"
}

variable "api_key" {
  description = "API key for authenticated endpoints (createProof). Empty = dev mode (no auth)."
  type        = string
  sensitive   = true
  default     = ""
}

## Azure Speech is derived from the Cognitive Services resource, no variable needed
