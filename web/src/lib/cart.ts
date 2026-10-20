import "server-only";
import { cookies } from "next/headers";
import { currentUserId } from "./api";

// Carrito del pedido en curso. Vive en una cookie por usuario: solo guarda cliente, artículos y cantidades;
// los precios los calcula siempre la API al mostrar el carrito y al enviar el pedido.

export interface Cart { customerId: string | null; lines: Record<string, number> }

const MAX_LINES = 200;

export async function cartCookie(): Promise<string | null> {
  const user = await currentUserId();
  return user ? `portal_cart_${user}` : null;
}

export async function readCart(): Promise<Cart> {
  const name = await cartCookie();
  const raw = name ? (await cookies()).get(name)?.value : undefined;
  if (!raw) return { customerId: null, lines: {} };
  try {
    const c = JSON.parse(raw) as Cart;
    const lines = Object.fromEntries(Object.entries(c.lines ?? {}).filter(([, q]) => typeof q === "number" && q > 0));
    return { customerId: typeof c.customerId === "string" ? c.customerId : null, lines };
  } catch {
    return { customerId: null, lines: {} };
  }
}

export async function writeCart(cart: Cart) {
  const name = await cartCookie();
  if (!name) return;
  const lines = Object.fromEntries(Object.entries(cart.lines).filter(([, q]) => q > 0).slice(0, MAX_LINES));
  const store = await cookies();
  if (Object.keys(lines).length === 0) store.delete(name);
  else store.set(name, JSON.stringify({ customerId: cart.customerId, lines }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export const cartCount = (c: Cart) => Object.keys(c.lines).length;
