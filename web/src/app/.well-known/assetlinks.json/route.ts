// Vincula la app de Google Play con este dominio para que abra sin barra del navegador.
// Se configura con ANDROID_PACKAGE y ANDROID_SHA256 (la huella de la firma que da Google Play Console).
export const dynamic = "force-dynamic";

export function GET() {
  const pkg = process.env.ANDROID_PACKAGE;
  const prints = (process.env.ANDROID_SHA256 ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const body = pkg && prints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints } }]
    : [];
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
