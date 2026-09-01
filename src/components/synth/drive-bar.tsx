export function DriveBar() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-1.5 shadow-border sm:py-2">
      <span className="w-16 shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-active">
        Transfer
      </span>
      <span className="min-w-0 flex-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        Input amplitude → authored output
      </span>
      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        bounded ±1
      </span>
    </div>
  );
}
