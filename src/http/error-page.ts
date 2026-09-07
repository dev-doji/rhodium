/**
 * The branded error page served to browsers.
 *
 * Everything on this service used to answer an error with raw JSON — fine for
 * the API, wrong for a person who mistyped a shop link and got
 * `{"error":"not_found"}` on a white page. Unknown paths were worse: the
 * catch-all handed back the merchant dashboard, so a bad URL looked like a
 * login screen rather than a dead end.
 *
 * One renderer, four surfaces. The copy changes with the status; the design
 * does not, because a buyer who lands here from a storefront and an admin who
 * lands here from /admin should both recognise where they are.
 */

export interface ErrorPageOptions {
  status: number;
  /**
   * Shown under the headline. Only pass something a stranger may safely read —
   * `renderErrorPage` does not decide that, the caller does.
   */
  detail?: string;
  /** Where "back to safety" points. Defaults to the site root. */
  homeHref?: string;
  homeLabel?: string;
}

interface Copy {
  title: string;
  headline: string;
  blurb: string;
}

/**
 * Written to be read by whoever actually hits each one: a buyer for 404, an
 * admin for 401/403, and someone who is about to contact you for 500.
 */
function copyFor(status: number): Copy {
  if (status === 400) {
    return {
      title: "Bad request",
      headline: "That link didn't come through properly",
      blurb:
        "Something in the address or the form was malformed, so we couldn't act on it. " +
        "If you followed a link, it may have been cut short — copying the whole thing usually fixes it.",
    };
  }
  if (status === 401 || status === 403) {
    return {
      title: "Not allowed",
      headline: "You need to be signed in for this",
      blurb:
        "Either the session has expired or this account cannot see this page. " +
        "Signing in again is the usual fix.",
    };
  }
  if (status === 404) {
    return {
      title: "Not found",
      headline: "There's nothing at this address",
      blurb:
        "The link may be wrong, or whatever used to be here has been removed. " +
        "It is worth checking the address for a missing character.",
    };
  }
  if (status === 429) {
    return {
      title: "Too many requests",
      headline: "That's a few too many tries",
      blurb: "Give it a minute and try again — the limit resets on its own.",
    };
  }
  return {
    title: "Something went wrong",
    headline: "Something broke on our side",
    blurb:
      "This one is ours, not yours. Nothing you did caused it, and no payment is affected by " +
      "this page. Trying again in a moment is worthwhile.",
  };
}

/** Escapes anything interpolated into the markup below. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderErrorPage(options: ErrorPageOptions): string {
  const { status } = options;
  const copy = copyFor(status);
  const homeHref = options.homeHref ?? "/";
  const homeLabel = options.homeLabel ?? "Go to Rhodium";
  const detail = options.detail ? escapeHtml(options.detail) : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(copy.title)} · Rhodium</title>
<!-- An error page in a search index is a dead end someone else can find. -->
<meta name="robots" content="noindex, nofollow" />
<link rel="stylesheet" href="/fonts/fonts.css">
<style>
  :root{
    color-scheme:light;
    --brand:#0033e7; --brand-600:#002bc4; --brand-50:#eef2fe;
    --ink:#05061a; --ink-2:#4a4f68; --ink-3:#6b7189;
    --line:#e4e7f2; --surface:#ffffff; --bg:#f7f8fc;
  }
  *{box-sizing:border-box}
  body{
    margin:0; min-height:100vh; background:var(--bg); color:var(--ink);
    font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;
    display:flex; align-items:center; justify-content:center; padding:24px;
  }
  .card{
    background:var(--surface); border:1px solid var(--line);
    max-width:560px; width:100%; padding:40px 36px;
  }
  .mark{
    font-family:Outfit,Inter,sans-serif; font-weight:800; font-size:19px;
    letter-spacing:-0.03em; margin-bottom:28px;
  }
  .mark span{color:var(--brand)}
  .code{
    font-family:Outfit,Inter,sans-serif; font-weight:800; font-size:64px;
    line-height:1; letter-spacing:-0.04em; color:var(--brand); margin-bottom:14px;
  }
  h1{
    font-family:Outfit,Inter,sans-serif; font-weight:700; font-size:27px;
    line-height:1.2; letter-spacing:-0.02em; margin:0 0 12px;
  }
  p{margin:0 0 10px; color:var(--ink-2); font-size:15.5px; line-height:1.6}
  .detail{
    margin-top:18px; padding:12px 14px; background:var(--brand-50);
    border-left:3px solid var(--brand); color:var(--ink-2); font-size:14px;
  }
  .actions{display:flex; flex-wrap:wrap; gap:10px; margin-top:28px}
  a.btn,button.btn{
    font:inherit; font-weight:600; font-size:15px; cursor:pointer;
    padding:12px 20px; border-radius:0; text-decoration:none;
    border:1px solid var(--brand); background:var(--brand); color:#fff;
  }
  a.btn:hover,button.btn:hover{background:var(--brand-600); border-color:var(--brand-600)}
  .btn.ghost{background:transparent; color:var(--brand-600)}
  .btn.ghost:hover{background:var(--brand-50)}
  .btn:focus-visible{outline:3px solid var(--brand); outline-offset:2px}
  @media (max-width:420px){
    .card{padding:30px 22px}
    .code{font-size:52px}
    h1{font-size:23px}
    .actions{flex-direction:column}
    .actions .btn{width:100%; text-align:center}
  }
</style>
</head>
<body>
  <main class="card">
    <div class="mark">Rhodium<span>.</span></div>
    <!-- The number is decorative; the headline carries the meaning, so a
         screen reader is not made to announce a bare integer first. -->
    <div class="code" aria-hidden="true">${status}</div>
    <h1>${escapeHtml(copy.headline)}</h1>
    <p>${escapeHtml(copy.blurb)}</p>
    ${detail ? `<p class="detail">${detail}</p>` : ""}
    <div class="actions">
      <a class="btn" href="${escapeHtml(homeHref)}">${escapeHtml(homeLabel)}</a>
      <button class="btn ghost" type="button" onclick="history.back()">Go back</button>
    </div>
  </main>
</body>
</html>
`;
}

/**
 * Whether this request should be answered with a page rather than JSON.
 *
 * A browser navigating sends `Accept: text/html,...`; fetch/XHR and curl do
 * not, and the dashboard's own API calls must keep receiving JSON or their
 * error handling breaks. Anything under an API prefix stays JSON regardless of
 * what it claims to accept.
 */
export function wantsHtml(req: {
  path?: string;
  originalUrl?: string;
  header(name: string): string | undefined;
}): boolean {
  const path = req.path ?? req.originalUrl ?? "";
  if (/^\/(api|webhooks|auth|health|metrics)\b/.test(path)) return false;
  const accept = req.header("accept") ?? "";
  return accept.includes("text/html");
}
