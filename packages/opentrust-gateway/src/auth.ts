export interface GatewayAuthClaims {
  token: string;
}

// MVP presence-only guard. Token signature and authorization are verified later.
export function extractGatewayBearerToken(
  authorization: string | undefined,
): GatewayAuthClaims {
  if (!authorization?.startsWith("Bearer ")) {
    throw new Error("missing_bearer_token");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("missing_bearer_token");
  }

  return { token };
}
