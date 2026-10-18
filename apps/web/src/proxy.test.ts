import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

function run(
  path: string,
  { cookie, acceptLanguage }: { cookie?: string; acceptLanguage?: string } = {},
) {
  const headers = new Headers();
  if (cookie !== undefined) headers.set("cookie", `NEXT_LOCALE=${cookie}`);
  if (acceptLanguage) headers.set("accept-language", acceptLanguage);
  const response = proxy(
    new NextRequest(new URL(path, "http://localhost"), { headers }),
  );
  return {
    status: response.status,
    location: response.headers.get("location"),
    rewrite: response.headers.get("x-middleware-rewrite"),
  };
}

describe("proxy locale routing", () => {
  it("rewrites to /en when the cookie says en, even for a Chinese browser", () => {
    const result = run("/", { cookie: "en", acceptLanguage: "zh-CN,zh;q=0.9" });
    expect(result.location).toBeNull();
    expect(new URL(result.rewrite!).pathname).toBe("/en");
  });

  it("redirects a Chinese browser without a cookie to /zh", () => {
    const result = run("/skills/x?q=1", { acceptLanguage: "zh-CN,zh;q=0.9" });
    expect(result.status).toBe(307);
    const location = new URL(result.location!);
    expect(location.pathname).toBe("/zh/skills/x");
    expect(location.search).toBe("?q=1");
  });

  it("redirects to /zh when the cookie says zh", () => {
    const result = run("/", { cookie: "zh", acceptLanguage: "en-US" });
    expect(result.status).toBe(307);
    expect(new URL(result.location!).pathname).toBe("/zh");
  });

  it("ignores an unsupported cookie value and falls back to Accept-Language", () => {
    expect(
      new URL(run("/", { cookie: "fr", acceptLanguage: "zh-CN" }).location!)
        .pathname,
    ).toBe("/zh");
    expect(
      new URL(run("/", { cookie: "fr", acceptLanguage: "en-US" }).rewrite!)
        .pathname,
    ).toBe("/en");
  });

  it("serves an explicit /zh link without redirecting, whatever the cookie", () => {
    const result = run("/zh/skills/x", {
      cookie: "en",
      acceptLanguage: "en-US",
    });
    expect(result.location).toBeNull();
    expect(result.rewrite).toBeNull();
    expect(result.status).toBe(200);
  });

  it("permanently redirects /en/... to the unprefixed path", () => {
    const result = run("/en/x", { cookie: "en" });
    expect(result.status).toBe(301);
    expect(new URL(result.location!).pathname).toBe("/x");
  });
});
