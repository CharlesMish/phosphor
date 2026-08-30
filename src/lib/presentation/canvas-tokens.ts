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

function readToken(element: Element, name: string, fallback: string) {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value || fallback;
}

function readNumber(element: Element, name: string, fallback: number) {
  const value = Number.parseFloat(readToken(element, name, String(fallback)));
  return Number.isFinite(value) ? value : fallback;
}

export function readCanvasTreatmentTokens(element: Element): CanvasTreatmentTokens {
  return {
    plot: readToken(element, "--ph-canvas-plot", "#050906"),
    gridMinor: readToken(element, "--ph-canvas-grid-minor", "#0f1813"),
    gridMajor: readToken(element, "--ph-canvas-grid-major", "#17251d"),
    axis: readToken(element, "--ph-canvas-axis", "#2b684c"),
    annotation: readToken(element, "--ph-canvas-annotation", "#566d60"),
    tracePrimary: readToken(element, "--ph-canvas-trace-primary", "#8ef5c0"),
    traceSecondary: readToken(element, "--ph-canvas-trace-secondary", "#4b8d6e"),
    traceGhost: readToken(element, "--ph-canvas-trace-ghost", "#4c9f78"),
    spaceFill: readToken(element, "--ph-canvas-space-fill", "#8ef5c0"),
    scopeTrace: readToken(element, "--ph-canvas-scope-trace", "#8ef5c0"),
    scopeIdle: readToken(element, "--ph-canvas-scope-idle", "#2f6f52"),
    scopeFade: readToken(element, "--ph-canvas-scope-fade", "rgba(5, 9, 6, 0.34)"),
    traceWidth: readNumber(element, "--ph-canvas-trace-width", 2),
    traceGlow: readNumber(element, "--ph-canvas-trace-glow", 8),
    ghostWidth: readNumber(element, "--ph-canvas-ghost-width", 1.35),
    ghostAlpha: readNumber(element, "--ph-canvas-ghost-alpha", 0.24),
    spaceFillAlpha: readNumber(element, "--ph-canvas-space-fill-alpha", 0.07),
    microstructureAlpha: readNumber(element, "--ph-canvas-microstructure-alpha", 0.34),
    scopeWidth: readNumber(element, "--ph-canvas-scope-width", 1.6),
    scopeGlow: readNumber(element, "--ph-canvas-scope-glow", 8),
  };
}
