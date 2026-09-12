import { DRIVE_SAFE_MAX_AMOUNT } from "./drive";
import { clampMotionValue } from "./motion";

export type MotionNumericRoute = Readonly<{ enabled: boolean; from: number; to: number }>;
export type MotionRoutes = Readonly<{
  cycle: Readonly<{ enabled: boolean; inverted: boolean }>;
  driveAmount: MotionNumericRoute;
  chorusMix: MotionNumericRoute;
  spaceMix: MotionNumericRoute;
}>;
export type MotionRouteId = keyof MotionRoutes;
export type MotionNumericRouteId = Exclude<MotionRouteId, "cycle">;
export type MotionRouteEndpoint = "from" | "to";

export const DEFAULT_MOTION_ROUTES: MotionRoutes = {
  cycle: { enabled: true, inverted: false },
  driveAmount: { enabled: false, from: 0, to: 0.25 },
  chorusMix: { enabled: false, from: 0, to: 0.35 },
  spaceMix: { enabled: false, from: 0.15, to: 0.55 },
};

export function motionRouteLimit(route: MotionNumericRouteId): number {
  return route === "driveAmount" ? DRIVE_SAFE_MAX_AMOUNT : 1;
}

export function clampMotionEndpoint(route: MotionNumericRouteId, value: number): number {
  return Math.min(motionRouteLimit(route), clampMotionValue(value));
}

export function mapMotionRoute(route: MotionNumericRouteId, range: MotionNumericRoute, value: number): number {
  const from = clampMotionEndpoint(route, range.from);
  const to = clampMotionEndpoint(route, range.to);
  return from + clampMotionValue(value) * (to - from);
}

export function hasPlayableMotionRoute(routes: MotionRoutes, cycleAvailable: boolean): boolean {
  return (routes.cycle.enabled && cycleAvailable) || routes.driveAmount.enabled ||
    routes.chorusMix.enabled || routes.spaceMix.enabled;
}
