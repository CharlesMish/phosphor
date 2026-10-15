import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, Download, FilePlus2, FolderOpen, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { soundSession } from "@/lib/synth/sound-session";
import { SOUND_NAME_MAX } from "@/lib/synth/sound-file";
import { cn } from "@/lib/utils";

export function downloadFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser time to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function savedLabel(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Save, reopen and move sounds. Lives in the header next to the treatment choice. */
export function SoundShelf() {
  const session = useSyncExternalStore(soundSession.subscribe, soundSession.getState);
  const libraryVersion = useSyncExternalStore(
    (fn) => soundSession.library.subscribe(fn),
    () => soundSession.library.version,
  );
  const [open, setOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const { entries, skipped } = open ? soundSession.library.list() : { entries: [], skipped: 0 };
  void libraryVersion;

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setConfirmId(null);
      soundSession.clearMessage();
    }
  }, [open]);

  const status = session.message
    || (!soundSession.library.available
      ? "This browser is not keeping sounds. Download them as files."
      : session.autosaved
        ? "Your current sound is kept in this browser and comes back when you reload."
        : "Edits are kept in this browser as you work.");

  return (
    <div ref={root} className="relative" onPointerDown={(event) => event.stopPropagation()}>
      <Button
        variant="subtle"
        className="h-9 max-w-[14rem] font-mono text-xs uppercase tracking-[0.04em]"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Sound: ${session.name}. Save, open or start a sound`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="truncate">{session.name}</span>
        <ChevronDown className="size-3 shrink-0 text-faint" aria-hidden />
      </Button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Sounds"
          className="fixed inset-x-3 top-16 z-30 grid max-h-[calc(100dvh-5rem)] gap-3 overflow-y-auto rounded-lg bg-surface p-3 shadow-border sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[22rem] sm:overflow-visible"
        >
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              soundSession.saveToLibrary();
            }}
          >
            <label className="grid flex-1 gap-1 font-mono text-xs uppercase tracking-wider text-muted">
              Sound name
              <input
                className="h-9 rounded-md bg-surface-2 px-2 font-sans text-sm normal-case tracking-normal text-fg shadow-border outline-none focus-visible:ring-2 focus-visible:ring-focus/50"
                value={session.name}
                maxLength={SOUND_NAME_MAX}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => soundSession.setName(event.currentTarget.value)}
              />
            </label>
            <Button type="submit" variant="solid" disabled={!soundSession.library.available}>
              <Save className="size-3.5" aria-hidden />
              Save
            </Button>
          </form>

          <p className="font-mono text-xs leading-relaxed text-muted" role="status" aria-live="polite">
            {status}
          </p>

          <div className="grid gap-1">
            <p className="font-mono text-xs uppercase tracking-wider text-faint">Saved in this browser</p>
            {entries.length === 0 ? (
              <p className="text-xs text-muted">Nothing saved yet. Name a sound and press Save.</p>
            ) : (
              <ul className="grid max-h-56 gap-1 overflow-y-auto pr-1">
                {entries.map(({ id, sound }) => (
                  <li
                    key={id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-2 py-1",
                      id === session.entryId ? "bg-active-soft" : "bg-surface-2",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-fg">{sound.name}</span>
                      <span className="block font-mono text-[0.7rem] text-faint">{savedLabel(sound.savedAt)}</span>
                    </span>
                    {confirmId === id ? (
                      <>
                        <Button variant="subtle" onClick={() => setConfirmId(null)}>Cancel</Button>
                        <Button
                          variant="outline"
                          aria-label={`Confirm delete ${sound.name}`}
                          onClick={() => {
                            soundSession.removeEntry(id);
                            setConfirmId(null);
                          }}
                        >
                          Delete
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="outline"
                          aria-label={`Load ${sound.name}`}
                          onClick={() => soundSession.loadEntry(id)}
                        >
                          Load
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-9"
                          aria-label={`Delete ${sound.name}`}
                          onClick={() => setConfirmId(id)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {skipped > 0 && (
              <p className="text-xs text-muted">
                {skipped === 1 ? "One saved sound" : `${skipped} saved sounds`} could not be read and {skipped === 1 ? "is" : "are"} hidden.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button variant="subtle" onClick={() => soundSession.newSound()}>
              <FilePlus2 className="size-3.5" aria-hidden />
              New
            </Button>
            <Button variant="subtle" onClick={() => downloadFile(soundSession.file())}>
              <Download className="size-3.5" aria-hidden />
              Download file
            </Button>
            <Button variant="subtle" onClick={() => fileInput.current?.click()}>
              <FolderOpen className="size-3.5" aria-hidden />
              Open file
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,.phosphor.json,application/json"
              className="hidden"
              aria-hidden
              tabIndex={-1}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void soundSession.open(file);
              }}
            />
          </div>
          <p className="text-xs leading-relaxed text-faint">
            Loading replaces the current sound and starts a fresh undo history. Notes that are already playing carry on with the new sound.
          </p>
        </div>
      )}
    </div>
  );
}
