"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { USER_COOKIE, apiPost } from "./api";

const DEMO_USERS = ["ana", "laura", "javier", "marta"];

export async function loginDemo(formData: FormData) {
  const user = String(formData.get("user") ?? "");
  if (!DEMO_USERS.includes(user)) redirect("/login");
  (await cookies()).set(USER_COOKIE, user, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(USER_COOKIE);
  redirect("/login");
}

export async function runSync() {
  await apiPost("/api/sync");
  revalidatePath("/sincronizacion");
}
