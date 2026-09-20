const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|rk)-[a-z0-9_-]{16,}\b/i,
  /\bgh[opsu]_[a-z0-9]{20,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bBearer\s+[a-z0-9._~+/=-]{16,}\b/i,
  /\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)\s*[:=]\s*[^\s,;]{8,}/i,
];

export function assertNoLikelySecret(values: string[]): void {
  const combined = values.join("\n");
  if (SECRET_PATTERNS.some((pattern) => pattern.test(combined))) {
    throw new Error(
      "FixMemory refused to store content that resembles a credential or private key. Remove or redact the secret and try again.",
    );
  }
}
