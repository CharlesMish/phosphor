import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  applySession,
  captureSession,
  createFactorySession,
  localRestoreReport,
  writeLocalSession,
} from "@/lib/synth/session-apply";
import { serializeSession, SessionFileError } from "@/lib/synth/session-file";

const BOOT_MESSAGE = {
  restored: "Saved session restored. Playback is stopped.",
  rejected: "The saved session in this browser was unreadable and was discarded.",
  empty: "",
  unavailable: "This browser is not keeping a local session.",
} as const;

export function SessionMenu() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string>(BOOT_MESSAGE[localRestoreReport]);
  const [open, setOpen] = useState(false);

  const download = () => {
    const session = captureSession();
    const blob = new Blob([serializeSession(session)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "phosphor-session.json";
    link.click();
    URL.revokeObjectURL(url);
    writeLocalSession();
    setMessage("Session file saved. Playback was not started.");
    setOpen(false);
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const text = await file.text();
      applySession(JSON.parse(text));
      writeLocalSession();
      setMessage("Session loaded. Playback is stopped.");
    } catch (error) {
      const reason = error instanceof SessionFileError || error instanceof SyntaxError
        ? "That file is not a supported Phosphor session."
        : "The session could not be loaded.";
      setMessage(`${reason} The current session was left unchanged.`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setOpen(false);
    }
  };

  const fresh = () => {
    if (!window.confirm("Start a new session? The current sound and note loop will be replaced.")) return;
    applySession(createFactorySession());
    writeLocalSession();
    setMessage("New session. Playback is stopped.");
    setOpen(false);
  };

  return (
    <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
      <Button
        variant="subtle"
        aria-expanded={open}
        aria-controls="session-menu"
        aria-label="Session"
        onClick={() => setOpen((value) => !value)}
      >
        Session
      </Button>
      {open ? (
        <div
          id="session-menu"
          className="absolute right-0 z-20 mt-1 flex w-56 flex-col gap-1 rounded-md bg-surface-2 p-2 shadow-border"
        >
          <Button variant="outline" aria-label="Save session file" onClick={download}>Save file</Button>
          <Button variant="outline" aria-label="Open session file" onClick={() => fileRef.current?.click()}>Open file</Button>
          <Button variant="subtle" aria-label="New session" onClick={fresh}>New</Button>
        </div>
      ) : null}
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Choose session file"
        onChange={(event) => void openFile(event.currentTarget.files?.[0])}
      />
      <p id="session-status" className={message ? "mt-1 max-w-64 font-mono text-[11px] leading-snug text-muted" : "sr-only"} role="status">
        {message}
      </p>
    </div>
  );
}
