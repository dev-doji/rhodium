import { describe, it, expect } from "vitest";
import { renderErrorPage, wantsHtml } from "../src/http/error-page.js";

/** A minimal stand-in for the parts of an Express request wantsHtml reads. */
function req(path: string, accept = ""): Parameters<typeof wantsHtml>[0] {
  return { path, header: (name: string) => (name === "accept" ? accept : undefined) };
}

const HTML_ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

describe("who gets a page and who gets JSON", () => {
  it("gives a browser a page", () => {
    expect(wantsHtml(req("/some/typo", HTML_ACCEPT))).toBe(true);
  });

  it("gives fetch and curl JSON", () => {
    expect(wantsHtml(req("/some/typo", "application/json"))).toBe(false);
    expect(wantsHtml(req("/some/typo", "*/*"))).toBe(false);
    expect(wantsHtml(req("/some/typo", ""))).toBe(false);
  });

  it("never turns an API response into a page, whatever the request claims to accept", () => {
    // The dashboards read `message` off a JSON body to decide what to show. An
    // HTML error page there is not a nicer failure — it is a broken client.
    for (const path of [
      "/api/admin/overview",
      "/api/traction",
      "/auth/otp/request",
      "/webhooks/paystack",
      "/health",
      "/metrics",
    ]) {
      expect(wantsHtml(req(path, HTML_ACCEPT)), path).toBe(false);
    }
  });

  it("does treat a page path that merely starts with those letters as a page", () => {
    // "/apiary" is not "/api". A prefix check without the boundary would send
    // a real page's errors back as JSON.
    expect(wantsHtml(req("/apiary", HTML_ACCEPT))).toBe(true);
    expect(wantsHtml(req("/authentic-goods", HTML_ACCEPT))).toBe(true);
  });
});

describe("the page itself", () => {
  it("says something different, and true, for each status", () => {
    expect(renderErrorPage({ status: 400 })).toContain("didn&#39;t come through properly");
    expect(renderErrorPage({ status: 404 })).toContain("nothing at this address");
    expect(renderErrorPage({ status: 429 })).toContain("too many tries");
    expect(renderErrorPage({ status: 500 })).toContain("broke on our side");
    expect(renderErrorPage({ status: 401 })).toContain("signed in");
  });

  it("keeps a stranger's error page out of search results", () => {
    expect(renderErrorPage({ status: 404 })).toContain('name="robots" content="noindex, nofollow"');
  });

  it("escapes anything it is handed", () => {
    // The detail comes from an AppError message, and those interpolate values
    // that came from a request — a shop handle, an order id. Unescaped, a
    // crafted link would run script on our own origin.
    const html = renderErrorPage({
      status: 404,
      detail: '<img src=x onerror="alert(1)">',
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x");
  });

  it("escapes the home link too", () => {
    const html = renderErrorPage({ status: 404, homeHref: '"><script>alert(1)</script>' });
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("shows no detail when none is given", () => {
    // A 500's real message is a stack frame or a driver string. The handler
    // passes nothing for those, and the page must not invent a placeholder.
    const html = renderErrorPage({ status: 500 });
    expect(html).not.toContain('class="detail"');
  });

  it("is a complete document, not a fragment", () => {
    const html = renderErrorPage({ status: 404 });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain('<meta name="viewport"');
  });

  it("does not announce a bare number to a screen reader before the headline", () => {
    expect(renderErrorPage({ status: 404 })).toContain('aria-hidden="true">404');
  });
});
