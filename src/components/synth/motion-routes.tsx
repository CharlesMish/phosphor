import type {
  MotionNumericRoute,
  MotionNumericRouteId,
  MotionRouteEndpoint,
  MotionRouteId,
} from "@/lib/synth/motion";
import { useSynthStore } from "@/lib/synth/store";
import { cn } from "@/lib/utils";

function PercentEndpoint({
  route,
  endpoint,
  value,
  label,
}: {
  route: MotionNumericRouteId;
  endpoint: MotionRouteEndpoint;
  value: number;
  label: string;
}) {
  const setEndpoint = useSynthStore((s) => s.setMotionRouteEndpoint);
  return (
    <label className="flex items-center gap-1">
      <span className="sr-only">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        step={1}
        value={Math.round(value * 100)}
        onChange={(event) => {
          const percent = event.currentTarget.valueAsNumber;
          if (Number.isFinite(percent)) {
            setEndpoint(route, endpoint, percent / 100);
          }
        }}
        className="h-8 w-14 rounded bg-surface-2 px-1.5 text-right font-mono text-[10px] tabular-nums text-fg shadow-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50 disabled:opacity-45"
      />
      <span className="text-[10px] text-muted">%</span>
    </label>
  );
}

function RouteToggle({
  route,
  checked,
  label,
}: {
  route: MotionRouteId;
  checked: boolean;
  label: string;
}) {
  const setEnabled = useSynthStore((s) => s.setMotionRouteEnabled);
  return (
    <label className="flex min-w-24 items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => setEnabled(route, event.currentTarget.checked)}
        className="size-4 shrink-0 accent-active outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
      />
      <span
        className={cn(
          "font-mono text-[10px] uppercase tracking-[0.14em]",
          checked ? "text-active" : "text-faint",
        )}
      >
        {label}
      </span>
    </label>
  );
}

function NumericRouteRow({
  id,
  label,
  route,
}: {
  id: MotionNumericRouteId;
  label: string;
  route: MotionNumericRoute;
}) {
  return (
    <div className="flex min-h-9 items-center gap-2 rounded-md bg-surface px-2 py-0.5 shadow-border">
      <RouteToggle route={id} checked={route.enabled} label={label} />
      <div className="ml-auto flex items-center gap-1 font-mono text-[10px] text-faint">
        <PercentEndpoint
          route={id}
          endpoint="from"
          value={route.from}
          label={`${label} Motion from`}
        />
        <span aria-hidden>→</span>
        <PercentEndpoint
          route={id}
          endpoint="to"
          value={route.to}
          label={`${label} Motion to`}
        />
      </div>
    </div>
  );
}

export function MotionRoutes() {
  const routes = useSynthStore((s) => s.motionRoutes);
  const playing = useSynthStore((s) => s.motionPlaying);
  const cycleAvailable = useSynthStore((s) => Boolean(s.slotA && s.slotB));

  return (
    <fieldset
      disabled={playing}
      className="min-w-0"
      aria-label="Motion routes"
    >
      <div className="mb-1 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
        <span>Routes</span>
        <span className="text-muted">One source · every enabled row</span>
      </div>
      <div className="grid gap-1 sm:grid-cols-2 xl:grid-cols-4">
        <div className="flex min-h-9 items-center gap-2 rounded-md bg-surface px-2 py-0.5 shadow-border">
          <RouteToggle
            route="cycle"
            checked={routes.cycle.enabled}
            label="Cycle"
          />
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            {cycleAvailable
              ? routes.cycle.inverted
                ? "B → A"
                : "A → B"
              : "Needs A+B"}
          </span>
        </div>
        <NumericRouteRow
          id="driveAmount"
          label="Drive"
          route={routes.driveAmount}
        />
        <NumericRouteRow
          id="chorusMix"
          label="Chorus"
          route={routes.chorusMix}
        />
        <NumericRouteRow
          id="spaceMix"
          label="Space"
          route={routes.spaceMix}
        />
      </div>
    </fieldset>
  );
}
