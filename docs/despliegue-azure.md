# Demo gratuita en Azure

La demo publica la web y la API en Azure Container Apps con los ficheros de ejemplo de SAP.
Está pensada para no salir del uso gratuito de Azure:

| Pieza | Configuración | Por qué no cuesta |
| --- | --- | --- |
| `portal-web` | 0,25 vCPU, 0,5 GiB, de 0 a 1 réplicas, acceso público | Se apaga sin visitas y queda dentro de la cuota gratuita mensual de Container Apps |
| `portal-api` | 0,25 vCPU, 0,5 GiB, de 0 a 1 réplicas, solo acceso interno | Igual que la web. Una sola réplica porque los datos de la demo viven en memoria |
| Imágenes | GitHub Container Registry | Gratis para el repositorio; no se usa Azure Container Registry |
| Registros | Desactivados (`--logs-destination none`) | Log Analytics se cobra por GB |
| Aviso de gasto | Presupuesto de 1 € con aviso por correo | Avisa de cualquier cargo |

La primera visita tras un rato sin uso tarda unos segundos, porque los contenedores arrancan de cero.
La demo aún no usa PostgreSQL ni Keycloak: se entra con los usuarios de ejemplo.

## Pasos

1. Crear la cuenta en https://azure.microsoft.com/es-es/free/.
2. Fusionar en `main`: el workflow **Publicar** construye las imágenes y las sube a `ghcr.io/lredondo90/portal-pedidos-api` y `-web`.
3. Crear en GitHub un token con permiso `read:packages` (Settings, Developer settings, Personal access tokens) para que Azure pueda descargar las imágenes.
4. Desde [Azure Cloud Shell](https://shell.azure.com) (Bash), con el repositorio clonado:

   ```bash
   GHCR_TOKEN=<token> BUDGET_EMAIL=<tu correo> ./infra/azure-demo.sh
   ```

   Al terminar imprime la dirección pública del portal.

5. Opcional, para que cada cambio en `main` se publique solo: crear un service principal con
   `az ad sp create-for-rbac --name portal-pedidos-ci --role contributor --scopes /subscriptions/<id>/resourceGroups/portal-pedidos-demo --sdk-auth`,
   guardar su salida como secreto `AZURE_CREDENTIALS` y crear la variable `AZURE_RESOURCE_GROUP=portal-pedidos-demo` en el repositorio.

## Borrar la demo

```bash
az group delete -n portal-pedidos-demo --yes
```
