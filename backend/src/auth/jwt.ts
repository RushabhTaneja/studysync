import jwt from "jsonwebtoken";
import { config } from "../config.js";

export type Role = "participant" | "researcher";

export interface TokenClaims {
  sub: string; // account id
  role: Role;
  email: string;
  name: string;
}

export function signToken(claims: TokenClaims): string {
  return jwt.sign(claims, config.jwtSecret, { expiresIn: "7d" });
}

export function verifyToken(token: string): TokenClaims {
  return jwt.verify(token, config.jwtSecret) as TokenClaims;
}
