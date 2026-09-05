export type CanvasTreatmentTokens = {
  plot: string;
  gridMinor: string;
  gridMajor: string;
  axis: string;
  annotation: string;
  tracePrimary: string;
  traceSecondary: string;
  traceGhost: string;
  spaceFill: string;
  scopeTrace: string;
  scopeIdle: string;
  scopeFade: string;
  traceWidth: number;
  traceGlow: number;
  ghostWidth: number;
  ghostAlpha: number;
  spaceFillAlpha: number;
  microstructureAlpha: number;
  scopeWidth: number;
  scopeGlow: number;
};

function readToken(style: CSSStyleDeclaration, name: string, fallback: string) {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

function readNumber(style: CSSStyleDeclaration, name: string, fallback: number) {
  const value = Number.parseFloat(readToken(style, name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export function readCanvasTreatmentTokens(element: Element): CanvasTreatmentTokens {
  const style = getComputedStyle(element);
  return {
    plot: readToken(style, "--ph-canvas-plot", "#050906"),
    gridMinor: readToken(style, "--ph-canvas-grid-minor", "#0f1813"),
    gridMajor: readToken(style, "--ph-canvas-grid-major", "#17251d"),
    axis: readToken(style, "--ph-canvas-axis", "#2b684c"),
    annotation: readToken(style, "--ph-canvas-annotation", "#566d60"),
    tracePrimary: readToken(style, "--ph-canvas-trace-primary", "#8ef5c0"),
    traceSecondary: readToken(style, "--ph-canvas-trace-secondary", "#4b8d6e"),
    traceGhost: readToken(style, "--ph-canvas-trace-ghost", "#4c9f78"),
    spaceFill: readToken(style, "--ph-canvas-space-fill", "#8ef5c0"),
    scopeTrace: readToken(style, "--ph-canvas-scope-trace", "#8ef5c0"),
    scopeIdle: readToken(style, "--ph-canvas-scope-idle", "#2f6f52"),
    scopeFade: readToken(style, "--ph-canvas-scope-fade", "rgba(5, 9, 6, 0.34)"),
    traceWidth: readNumber(style, "--ph-canvas-trace-width", 2),
    traceGlow: readNumber(style, "--ph-canvas-trace-glow", 8),
    ghostWidth: readNumber(style, "--ph-canvas-ghost-width", 1.35),
    ghostAlpha: readNumber(style, "--ph-canvas-ghost-alpha", 0.24),
    spaceFillAlpha: readNumber(style, "--ph-canvas-space-fill-alpha", 0.07),
    microstructureAlpha: readNumber(style, "--ph-canvas-microstructure-alpha", 0.34),
    scopeWidth: readNumber(style, "--ph-canvas-scope-width", 1.6),
    scopeGlow: readNumber(style, "--ph-canvas-scope-glow", 8),
  };
}
