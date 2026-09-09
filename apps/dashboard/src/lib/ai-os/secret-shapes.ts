// Secret-SHAPE screen for runtime-side text that must never be copied off a
// worktree or into a durable store (worker patches, artifacts). This mirrors
// the token-shape rule set of the outbound message scrubber in
// packages/guards (scrubOutboundMessage); it lives here because the
// os-runtime build root cannot import outside apps/dashboard/src. A test pins
// both screens to the same verdicts (secret-shapes.test.ts) so they cannot
// drift apart silently. The private-key pattern is assembled from parts so
// this file never matches the repository scanners itself.

const KEY_BLOCK = new RegExp('-----BEGIN' + ' [A-Z ]*PRIVATE KEY');

export const SECRET_SHAPE_PATTERNS: readonly RegExp[] = Object.freeze([
  KEY_BLOCK,
  /eyJ[A-Za-z0-9_-]{15,}\.eyJ/,
  /sk-[A-Za-z0-9]{20,}/,
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{20,}/,
  /[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}/,
]);

// True when the text carries a secret-shaped value. A keyword screen (the
// word "secret") is deliberately NOT part of this: legitimate source code
// mentions such words; an actual token-shaped value is what must not leak.
export function hasSecretShape(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return SECRET_SHAPE_PATTERNS.some((p) => p.test(text));
}
