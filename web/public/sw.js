// Service worker del portal.
// - Guarda los ficheros estáticos de la app, una página sin conexión y la página de pedidos sin cobertura.
// - Nunca guarda páginas con datos: los datos para pedir sin cobertura los guarda la propia página en IndexedDB
//   (src/lib/offline.ts), solo los de la cartera del usuario.
// - En Android envía los pedidos pendientes aunque la app esté cerrada (Background Sync). iPhone no lo tiene:
//   allí se envían al abrir la app o al volver la red.
const VERSION = "v2";
const STATIC = `static-${VERSION}`;
const SHELL = `shell-${VERSION}`;
const OFFLINE = "/offline.html";
const ORDERS_PAGE = "/sin-conexion";
const SHELL_FILES = [OFFLINE, "/icon-192.png"];

// Guarda la página de pedidos sin cobertura y los ficheros que necesita para abrirse sin red.
async function keepOrdersPage() {
  const res = await fetch(ORDERS_PAGE, { cache: "no-store", credentials: "same-origin" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await (await caches.open(SHELL)).put(ORDERS_PAGE, res);
  const assets = [...new Set(html.match(/\/_next\/static\/[^"'\s)\\]+/g) ?? [])];
  const cache = await caches.open(STATIC);
  await Promise.all(
    assets.map(async (a) => {
      if (await cache.match(a)) return;
      const r = await fetch(a).catch(() => null);
      if (r?.ok) await cache.put(a, r);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(SHELL_FILES))
      .then(() => keepOrdersPage().catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "guardar-sin-conexion") event.waitUntil(keepOrdersPage().catch(() => {}));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    if (url.pathname === ORDERS_PAGE) {
      // Con red, la versión nueva (y se guarda); sin red, la guardada.
      event.respondWith(
        fetch(req)
          .then(async (res) => {
            if (res.ok) {
              const copy = res.clone();
              event.waitUntil(caches.open(SHELL).then((c) => c.put(ORDERS_PAGE, copy)));
            }
            return res;
          })
          .catch(async () => (await caches.match(ORDERS_PAGE)) ?? caches.match(OFFLINE)),
      );
      return;
    }
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
    return;
  }

  if (SHELL_FILES.includes(url.pathname)) {
    event.respondWith(fetch(req).catch(() => caches.match(url.pathname)));
    return;
  }

  // Los ficheros de /_next/static llevan huella en el nombre: no cambian nunca.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
  }
});

// --- Envío en segundo plano (Android) ---
// Misma base de datos y mismas reglas que src/lib/offline.ts, en versión reducida: si algo no sale bien,
// el pedido se queda pendiente y lo reintenta la página. El id del pedido evita duplicados si los dos envían a la vez.

self.addEventListener("sync", (event) => {
  if (event.tag === "enviar-pedidos") event.waitUntil(sendPending());
});

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("portal-offline", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("packs", { keyPath: "userId" });
      req.result.createObjectStore("outbox", { keyPath: "clientId" });
      req.result.createObjectStore("meta");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(d, store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r?.result);
    t.onerror = () => reject(t.error);
  });
}

async function sendPending() {
  const work = async () => {
    const d = await db();
    try {
      const user = await run(d, "meta", "readonly", (s) => s.get("user"));
      if (!user) return;
      const all = (await run(d, "outbox", "readonly", (s) => s.getAll())) ?? [];
      const due = all.filter((o) => o.userId === user && o.status === "pendiente").sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
      for (const o of due) {
        const body = {
          customerId: o.customerId, customerReference: o.customerReference, requestedDate: o.requestedDate, shipToId: o.shipToId, notes: o.notes,
          userId: o.userId, clientId: o.clientId, capturedAt: o.capturedAt, lines: o.lines.map((l) => ({ materialId: l.materialId, quantity: l.quantity })),
        };
        // Un fallo de red rechaza la promesa: el navegador volverá a lanzar el evento más tarde.
        const res = await fetch("/api/offline/pedidos", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const data = await res.json().catch(() => null);
        const base = { ...o, attempts: (o.attempts ?? 0) + 1, lastTryAt: new Date().toISOString() };
        if ((res.status === 200 || res.status === 201) && data?.id) {
          await run(d, "outbox", "readwrite", (s) => s.put({ ...base, status: "enviado", sentAt: new Date().toISOString(), result: { tenantId: data.tenantId, id: data.id }, message: undefined }));
        } else if (res.status === 400 || res.status === 404) {
          const why = Array.isArray(data?.errors) ? data.errors.join(" ") : res.status === 404 ? "Este cliente ya no aparece en tu cartera." : "Revisa los datos del pedido.";
          await run(d, "outbox", "readwrite", (s) => s.put({ ...base, status: "revisar", message: why }));
        } else {
          return; // sin sesión o el portal no responde: lo reintenta la página al abrirse
        }
      }
    } finally {
      d.close();
    }
  };
  await (self.navigator.locks ? self.navigator.locks.request("portal-outbox", work) : work());
}
