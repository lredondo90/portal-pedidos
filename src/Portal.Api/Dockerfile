# Se construye desde la raíz del repositorio: docker build -f src/Portal.Api/Dockerfile .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet publish src/Portal.Api -c Release -o /out

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /out .
# Ficheros de ejemplo de SAP para la demo. En producción la carpeta de entrada se monta desde Azure Files.
COPY samples/sap-export /app/inbox
ENV ASPNETCORE_URLS=http://+:8080 Erp__SapFiles__InboxPath=/app/inbox
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Portal.Api.dll"]
