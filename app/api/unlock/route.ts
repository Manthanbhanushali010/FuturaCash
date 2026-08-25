import { NextResponse } from "next/server";
import {
  GATE_COOKIE,
  GATE_MAX_AGE_SECONDS,
  gateDigest,
  isPasswordCorrect,
  safeReturnPath,
} from "@/lib/page-gate";

/**
 * Verify the shared password and mint the gate cookie.
 *
 * 303 on both paths so the browser follows with GET and a refresh cannot re-submit the
 * password. The cookie is httpOnly — page JavaScript has no reason to read it, and that keeps
 * it out of reach of anything injected into the page.
 */
export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const submitted = String(form.get("password") ?? "");
  const next = safeReturnPath(String(form.get("next") ?? ""));

  if (!(await isPasswordCorrect(submitted))) {
    const retry = new URL("/unlock", request.url);
    retry.searchParams.set("next", next);
    retry.searchParams.set("error", "1");
    return NextResponse.redirect(retry, 303);
  }

  const password = process.env.XERO_PAGE_PASSWORD ?? "";
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(GATE_COOKIE, await gateDigest(password), {
    httpOnly: true,
    sameSite: "lax",
    // Localhost is plain http, so Secure would silently drop the cookie in development.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GATE_MAX_AGE_SECONDS,
  });
  return response;
}
