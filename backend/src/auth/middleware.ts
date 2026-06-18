import type { Request, Response, NextFunction } from "express";
import { verifyToken, type Role, type TokenClaims } from "./jwt.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenClaims;
    }
  }
}

/** Attaches req.user if a valid bearer token is present; does not reject. */
export function authOptional(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    try {
      req.user = verifyToken(header.slice(7));
    } catch {
      /* ignore invalid token */
    }
  }
  next();
}

/** Requires a valid token; optionally restricts to specific roles. */
export function requireAuth(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Authentication required" });
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden: insufficient role" });
    }
    next();
  };
}
