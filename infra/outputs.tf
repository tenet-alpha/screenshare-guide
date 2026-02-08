output "resource_group_name" {
  value = azurerm_resource_group.main.name
}

output "acr_login_server" {
  value = azurerm_container_registry.main.login_server
}

output "acr_admin_username" {
  value     = azurerm_container_registry.main.admin_username
  sensitive = true
}

output "acr_admin_password" {
  value     = azurerm_container_registry.main.admin_password
  sensitive = true
}

output "app_service_url" {
  value = "https://${azurerm_linux_web_app.main.default_hostname}"
}

output "app_service_name" {
  value = azurerm_linux_web_app.main.name
}

output "app_service_principal_id" {
  value       = azurerm_linux_web_app.main.identity[0].principal_id
  description = "App Service managed identity principal ID"
}

output "postgresql_fqdn" {
  value = azurerm_postgresql_flexible_server.main.fqdn
}

output "postgresql_database_url" {
  value     = "postgresql://${var.pg_admin_username}:${var.pg_admin_password}@${azurerm_postgresql_flexible_server.main.fqdn}:5432/screenshare?sslmode=require"
  sensitive = true
}

output "storage_account_name" {
  value = azurerm_storage_account.main.name
}

output "storage_connection_string" {
  value     = azurerm_storage_account.main.primary_connection_string
  sensitive = true
}

output "storage_container_name" {
  value = azurerm_storage_container.recordings.name
}

output "speech_endpoint" {
  value = "https://${azurerm_resource_group.main.location}.tts.speech.microsoft.com"
}

output "key_vault_name" {
  value = azurerm_key_vault.main.name
}

output "key_vault_uri" {
  value = azurerm_key_vault.main.vault_uri
}

output "static_web_app_url" {
  value = "https://${azurerm_static_web_app.frontend.default_host_name}"
}

output "static_web_app_api_key" {
  value     = azurerm_static_web_app.frontend.api_key
  sensitive = true
}

output "appinsights_connection_string" {
  value     = local.appinsights_connection_string
  sensitive = true
}

output "appinsights_instrumentation_key" {
  value = (
    var.appinsights_mode == "create"
    ? azurerm_application_insights.main[0].instrumentation_key
    : "(using existing instance)"
  )
  sensitive = true
}
