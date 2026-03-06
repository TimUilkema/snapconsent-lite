import { NextResponse } from "next/server";

export function redirectRelative(request: Request, path: string, status = 303) {
  if (!path.startsWith("/")) {
    throw new Error("redirect path must start with '/'");
  }

  const response = NextResponse.redirect(request.url, { status });
  response.headers.set("location", path);
  return response;
}
