import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { renderErrorPage, wantsHtml } from "./error-page.js";

const log = logger("http");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (wantsHtml(_req)) {
      // An AppError's message is written for whoever triggered it — "no shop is
      // registered on this number", "that code is not valid" — so it is safe to
      // show. Unhandled errors below are not, and say nothing.
      res.status(err.status).type("html").send(
        renderErrorPage({ status: err.status, detail: err.message }),
      );
      return;
    }
    res.status(err.status).json({ error: err.code, message: err.message, meta: err.meta });
    return;
  }
  log.error({ err: (err as Error).message, stack: (err as Error).stack }, "unhandled error");
  if (wantsHtml(_req)) {
    // Deliberately no detail: an unhandled error's message is a stack frame, a
    // driver string or a provider's raw response, and none of those belong on
    // a stranger's screen.
    res.status(500).type("html").send(renderErrorPage({ status: 500 }));
    return;
  }
  res.status(500).json({ error: "internal", message: "internal server error" });
}

export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
