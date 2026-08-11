import type { Request, Response, NextFunction } from "express";
import type { AuthService } from "../modules/auth/auth-service.js";
import { UnauthorizedError } from "../lib/errors.js";

export interface AuthedRequest extends Request {
  merchantId?: string;
}

/** Bearer-token guard for dashboard API routes. */
export function requireMerchant(auth: AuthService) {
  return (req: AuthedRequest, _res: Response, next: NextFunction): void => {
    const header = req.header("authorization");
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedError("missing bearer token");
    }
    req.merchantId = auth.verifyToken(header.slice("Bearer ".length));
    next();
  };
}
