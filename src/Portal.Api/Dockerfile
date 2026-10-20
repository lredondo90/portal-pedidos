# Se construye desde la raíz del repositorio: docker build -f src/Portal.Api/Dockerfile .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish src/Portal.Api -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
# Ficheros de ejemplo de SAP para la demo. En producción las carpetas de entrada y salida se montan desde Azure Files.
# El usuario app tiene que poder escribir en las dos: el portal deja ahí los pedidos y el SAP simulado sus respuestas.
COPY --chown=app:app samples/sap-export /app/inbox
RUN mkdir -p /app/outbox && chown app:app /app/outbox
ENV ASPNETCORE_URLS=http://+:8080 Erp__SapFiles__InboxPath=/app/inbox Erp__SapFiles__OutboxPath=/app/outbox
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Portal.Api.dll"]
