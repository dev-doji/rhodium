import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

const log = logger("http");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code, message: err.message, meta: err.meta });
    return;
  }
  log.error({ err: (err as Error).message, stack: (err as Error).stack }, "unhandled error");
  res.status(500).json({ error: "internal", message: "internal server error" });
}

export function asyncRoute(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
