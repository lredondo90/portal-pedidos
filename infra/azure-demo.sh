#!/usr/bin/env bash
# Crea la demo gratuita del portal en Azure Container Apps.
# Requisitos: Azure CLI con sesión iniciada (az login) y un token de GitHub con permiso read:packages
# para descargar las imágenes privadas de ghcr.io.
#
# Uso: GHCR_TOKEN=<token> ./infra/azure-demo.sh
set -euo pipefail

RG="${RG:-portal-pedidos-demo}"
LOCATION="${LOCATION:-spaincentral}"
ENV_NAME="${ENV_NAME:-portal-pedidos-env}"
OWNER="${OWNER:-lredondo90}"
BUDGET_EMAIL="${BUDGET_EMAIL:?Indica BUDGET_EMAIL para el aviso de gasto}"
: "${GHCR_TOKEN:?Indica GHCR_TOKEN (token de GitHub con read:packages)}"

az extension add --name containerapp --upgrade --only-show-errors
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait

az group create -n "$RG" -l "$LOCATION" -o none

# Entorno sin Log Analytics para no generar coste de registros.
az containerapp env create -g "$RG" -n "$ENV_NAME" -l "$LOCATION" --logs-destination none -o none

# API: solo accesible desde dentro del entorno. Máximo una réplica porque el almacén de la demo vive en memoria.
az containerapp create -g "$RG" -n portal-api --environment "$ENV_NAME" \
  --image "ghcr.io/$OWNER/portal-pedidos-api:latest" \
  --registry-server ghcr.io --registry-username "$OWNER" --registry-password "$GHCR_TOKEN" \
  --target-port 8080 --ingress internal \
  --cpu 0.25 --memory 0.5Gi --min-replicas 0 --max-replicas 1 -o none

# Web: pública, se apaga sin visitas (min-replicas 0) para no salir del uso gratuito.
az containerapp create -g "$RG" -n portal-web --environment "$ENV_NAME" \
  --image "ghcr.io/$OWNER/portal-pedidos-web:latest" \
  --registry-server ghcr.io --registry-username "$OWNER" --registry-password "$GHCR_TOKEN" \
  --target-port 3000 --ingress external \
  --env-vars PORTAL_API_URL=http://portal-api \
  --cpu 0.25 --memory 0.5Gi --min-replicas 0 --max-replicas 1 -o none

# Aviso por correo en cuanto el gasto del mes pase de 1 €.
SUB=$(az account show --query id -o tsv)
az consumption budget create-with-rg -g "$RG" --budget-name aviso-1-euro --amount 1 --category cost --time-grain monthly \
  --start-date "$(date +%Y-%m-01)" --end-date "$(date -d '+2 years' +%Y-%m-01)" \
  --notifications "{\"Actual_GreaterThan_0_Percent\":{\"enabled\":true,\"operator\":\"GreaterThan\",\"threshold\":0,\"contactEmails\":[\"$BUDGET_EMAIL\"]}}" -o none \
  || echo "No se pudo crear el aviso de gasto automáticamente; créalo en Cost Management > Budgets (suscripción $SUB)."

echo "Portal publicado en: https://$(az containerapp show -g "$RG" -n portal-web --query properties.configuration.ingress.fqdn -o tsv)"
