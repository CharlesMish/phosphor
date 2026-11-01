import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import starterData from "../../presets/starter.pack.json" with { type: "json" };
import { SoundLibrary, browserStorage, createSoundId, legacyEntry } from "@/lib/synth/sound-library";
import { applySound, captureSound } from "@/lib/synth/sound-session";
import { MAX_PACK_BYTES, parseJsonFile, parseSound, soundFromSession } from "@/lib/synth/sound-file";
import { auditionId, CHARACTER, defaultMetadata, matchesPreset, parsePack, ROLES, type PresetEntry, type PresetMetadata, type Role } from "@/lib/synth/preset-pack";
import { demoSession } from "@/lib/synth/preset-audition";
import { renderPhrase } from "@/lib/synth/phrase-render";
import { acceptPhraseResult, beginPhraseJob, encodePhraseWav, invalidatePhraseRenders, playPhraseRender, setPhraseAuditionTrim, stopPhraseAudition } from "@/lib/synth/phrase-export";
import { captureSession } from "@/lib/synth/session-apply";
import { parseSessionDocument, serializeSession } from "@/lib/synth/session-file";
import { useSynthStore } from "@/lib/synth/store";
import { synth } from "@/lib/synth/engine";
import { noteLooper } from "@/lib/synth/looper-runtime";

const library = new SoundLibrary(browserStorage(), parsePack(starterData).entries);
const field = "rounded-md bg-surface-2 px-2 py-1.5 text-sm text-fg shadow-border min-w-0";
export function downloadFile(file: File) {
  const url = URL.createObjectURL(file); const link = document.createElement("a");
  link.href = url; link.download = file.name; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function jsonFile(data: unknown, name: string) { downloadFile(new File([JSON.stringify(data, null, 2)], name, { type: "application/json" })); }

/** PR #15's one header shelf, extended with protected originals and role audition. */
export function SoundShelf() {
  const libraryVersion = useSyncExternalStore(library.subscribe, () => library.version);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<Role | "all">("all");
  const [demoRole, setDemoRole] = useState<Role>("keys");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [blind, setBlind] = useState(false);
  const [draft, setDraft] = useState<PresetMetadata>(defaultMetadata("My sound"));
  const [message, setMessage] = useState(library.warning);
  const [busy, setBusy] = useState(false);
  const [trim, setTrim] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => library.list(), [libraryVersion]);
  const favorites = useMemo(() => library.favorites(), [libraryVersion]);
  const current = rows.find(r => r.entry.id === selected);
  const state = useSynthStore();
  const visible = rows.filter(r => matchesPreset(r.entry, role, query, blind) && (!favoritesOnly || favorites.includes(r.entry.id)));
  const label = (e: PresetEntry) => blind ? auditionId(e.id) : e.metadata.name;
  const stop = () => { abort.current?.abort(); invalidatePhraseRenders(); stopPhraseAudition(); };
  useEffect(() => () => { abort.current?.abort(); stopPhraseAudition(); synth.setAuditionTrim(0); setPhraseAuditionTrim(0); }, []);
  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => { if (event.code === "Escape") { stop(); setOpen(false); } };
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener("keydown", key); window.addEventListener("pointerdown", outside);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("pointerdown", outside); };
  }, [open]);
  const perform = async (action: () => void | Promise<void>) => {
    try { await action(); } catch (error) { setMessage((error as Error).message); }
  };
  const load = async (entry: PresetEntry) => {
    setBusy(true);
    try {
      stop(); await applySound(entry.sound); setSelected(entry.id); setDraft(structuredClone(entry.metadata));
      if (role === "all") setDemoRole(entry.metadata.roles[0]);
      setMessage(`${blind ? auditionId(entry.id) : entry.metadata.name} loaded. Take, tempo and monitor kept. Playback stopped.`);
    } finally { setBusy(false); }
  };
  const save = () => perform(() => {
    const entry = library.saveNew(captureSound(), { ...draft, contributor: "Local author", provenance: current ? `Edited from ${current.entry.id} v${current.entry.version}` : "Authored in Phosphor", validation: "authored-unheard", measurements: [], listeningNotes: [] });
    setSelected(entry.id); setMessage(library.available ? "Saved as a new sound. Original preserved." : "Kept for this visit only. Export to retain it.");
  });
  const importFile = async (source?: File) => {
    if (!source) return;
    await perform(async () => {
      if (source.size > MAX_PACK_BYTES) throw new Error("File exceeds 4 MB.");
      const input = parseJsonFile(await source.text()) as { format?: string; version?: number };
      let entries: PresetEntry[];
      if (input.format === "phosphor-preset-pack") entries = library.importPack(input);
      else {
        const id = createSoundId("imported");
        const entry = input.format === "phosphor-sound" && input.version === 1 ? legacyEntry(input, id) : {
          id, version: 1, metadata: defaultMetadata("Imported sound"),
          sound: input.format === "phosphor-session" ? soundFromSession(parseSessionDocument(input)) : parseSound(input),
        };
        if (input.format === "phosphor-session") entry.metadata.recommendedBpm = parseSessionDocument(input).motion.bpm;
        entries = library.importPack({ format: "phosphor-preset-pack", version: 1, namespace: "imported", entries: [entry] });
      }
      setMessage(`${entries.length} sound(s) imported. Select one to load. Existing IDs are never replaced.`);
    });
  };
  const demo = async (moving: boolean, exportWav = false) => {
    if (noteLooper.getSnapshot().state === "recording") { setMessage("Finish recording first. Your take is untouched."); return; }
    stop(); synth.unlock(); noteLooper.stop(); state.stopMotion(); synth.allNotesOff();
    setBusy(true); const controller = new AbortController(); abort.current = controller;
    const job = beginPhraseJob(); const before = serializeSession(captureSession());
    const volume = state.volume;
    try {
      const session = demoSession(captureSound(), demoRole, moving, state.motionBpm, volume);
      const result = await renderPhrase(session, { signal: controller.signal, onProgress: p => setMessage(`Rendering ${Math.round(p * 100)}%…`) });
      if (acceptPhraseResult(job, before, serializeSession(captureSession())) !== "ok") throw new Error("Sound changed; render discarded. Start the demo again.");
      if (exportWav) {
        const bytes = encodePhraseWav(session, result);
        downloadFile(new File([Uint8Array.from(bytes)], `${current ? auditionId(current.entry.id) : "current"}-${demoRole.replaceAll("/", "-")}-${moving ? "motion" : "static"}.wav`, { type: "audio/wav" }));
      } else playPhraseRender(result, volume);
      setMessage(`${exportWav ? "Exported" : "Playing"} ${moving ? "Motion" : "static"} ${demoRole} phrase, ${state.motionBpm} BPM. Peak ${result.peak.toFixed(3)}; leading rest and tail kept. No normalization.`);
    } catch (error) { setMessage(controller.signal.aborted ? "Demo cancelled." : (error as Error).message); }
    finally { setBusy(false); abort.current = null; }
  };
  return <div ref={root} className="relative" onPointerDown={e => e.stopPropagation()}>
    <Button variant="subtle" aria-label="Sounds" aria-expanded={open} aria-controls="sound-shelf" onClick={() => setOpen(!open)}>Sounds</Button>
    {open && <div id="sound-shelf" role="dialog" aria-label="Sound library" className="fixed inset-x-3 top-16 z-30 grid max-h-[calc(100dvh-5rem)] gap-3 overflow-y-auto rounded-lg bg-surface p-4 shadow-border sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[36rem] sm:max-h-[75dvh]">
      <div className="flex items-center justify-between"><strong>Sound library</strong><Button variant="subtle" onClick={() => setOpen(false)}>Close</Button></div>
      <div className="flex flex-wrap gap-2">
        <input className={`${field} flex-1`} aria-label="Search sounds" placeholder="warm keys, dark moving pad…" value={query} onChange={e => setQuery(e.target.value)} />
        <select className={field} aria-label="Filter role" value={role} onChange={e => { const r = e.target.value as Role | "all"; setRole(r); if (r !== "all") setDemoRole(r); }}><option value="all">All roles</option>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label><input type="checkbox" checked={favoritesOnly} onChange={e => setFavoritesOnly(e.target.checked)} /> Favorites</label>
        <label><input type="checkbox" checked={blind} disabled={busy} onChange={e => { setBlind(e.target.checked); setQuery(""); setMessage(""); }} /> Blind labels</label>
      </div>
      <ul className="grid max-h-44 gap-1 overflow-y-auto" aria-label="Preset list">
        {visible.map(({ entry }) => <li key={entry.id} className={`flex items-center gap-2 rounded-md p-2 ${entry.id === selected ? "bg-active-soft" : "bg-surface-2"}`}>
          <button aria-label={`Favorite ${label(entry)}`} aria-pressed={favorites.includes(entry.id)} onClick={() => void perform(() => library.favorite(entry.id))}>{favorites.includes(entry.id) ? "★" : "☆"}</button>
          <button className="min-w-0 flex-1 text-left" aria-label={`Load ${label(entry)}`} disabled={busy} onClick={() => void perform(() => load(entry))}><span className="block truncate">{label(entry)}</span><small className="text-muted">{entry.metadata.roles.join(" · ")} · {entry.metadata.character.brightness} · {entry.metadata.character.body}</small></button>
        </li>)}
      </ul>
      {!visible.length && <p className="text-sm text-muted">No matching sounds.</p>}
      {current && <div className="grid gap-1 text-sm">
        <strong>{label(current.entry)}{!blind && ` · ${current.editable ? "your copy" : "protected original"}`}</strong>
        {!blind && <span className="text-muted">{current.entry.metadata.contributor} · {current.entry.metadata.validation}</span>}
        <span>MIDI {current.entry.metadata.range.join("–")} · {current.entry.metadata.playing}</span>
        {!blind && <><p>{current.entry.metadata.tryThis}</p><p className="text-muted">{current.entry.metadata.release}</p></>}
        <p>Tempo: {state.motionBpm} BPM{current.entry.metadata.recommendedBpm !== null && <> · suggested {current.entry.metadata.recommendedBpm} <Button variant="subtle" disabled={busy} onClick={() => { stop(); state.setMotionBpm(current.entry.metadata.recommendedBpm!); }}>Use suggested tempo</Button></>}</p>
      </div>}
      <div className="grid gap-2 border-t border-border pt-2">
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm">Same phrase:</span><select aria-label="Demo role" className={field} value={demoRole} onChange={e => setDemoRole(e.target.value as Role)}>{ROLES.map(r => <option key={r}>{r}</option>)}</select><Button variant="outline" disabled={busy} onClick={() => void demo(false)}>Static demo</Button><Button variant="outline" disabled={busy} onClick={() => void demo(true)}>Motion demo</Button><Button variant="subtle" onClick={stop}>Stop demo</Button></div>
        <div className="flex flex-wrap gap-2"><Button variant="subtle" disabled={busy} onClick={() => void demo(false, true)}>Export static WAV</Button><Button variant="subtle" disabled={busy} onClick={() => void demo(true, true)}>Export Motion WAV</Button><Button variant="subtle" disabled={busy} onClick={() => { stop(); state.motionPlaying ? state.stopMotion() : state.playMotion(); }}>{state.motionPlaying ? "Stop Motion" : "Start Motion for keys"}</Button></div>
        <label className="flex items-center gap-2 text-xs">Listening trim {trim} dB<input aria-label="Listening trim" type="range" min={-24} max={0} step={1} value={trim} onChange={e => { const db = +e.target.value; setTrim(db); synth.setAuditionTrim(db); setPhraseAuditionTrim(db); }} /></label>
        <span className="text-xs text-muted">Listening trim affects audition and free playing only. WAV keeps authored trim. Motion starts only on request.</span>
      </div>
      {!blind && <form className="grid gap-2 border-t border-border pt-2" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="flex gap-2"><input aria-label="Sound name" className={`${field} flex-1`} maxLength={80} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /><Button type="submit" variant="solid" disabled={busy}>Save as new</Button></div>
        <details><summary className="cursor-pointer text-sm">Author tags and instructions</summary><div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          {ROLES.map(r => <label key={r}><input type="checkbox" checked={draft.roles.includes(r)} onChange={e => setDraft({ ...draft, roles: e.target.checked ? [...draft.roles, r] : draft.roles.filter(v => v !== r) })} /> {r}</label>)}
          {Object.entries(CHARACTER).map(([key, values]) => <label key={key} className="grid gap-1">{key}<select className={field} value={draft.character[key as keyof typeof CHARACTER]} onChange={e => setDraft({ ...draft, character: { ...draft.character, [key]: e.target.value } })}>{values.map(v => <option key={v}>{v}</option>)}</select></label>)}
          <label className="grid gap-1">Extra tags<input className={field} value={draft.tags.join(", ")} onChange={e => setDraft({ ...draft, tags: e.target.value.split(",").map(v => v.trim()).filter(Boolean) })} /></label>
          <label className="grid gap-1">Playing<select className={field} value={draft.playing} onChange={e => setDraft({ ...draft, playing: e.target.value as PresetMetadata["playing"] })}>{["sustained", "short-note", "both"].map(v => <option key={v}>{v}</option>)}</select></label>
          {[0,1].map(i => <label key={i}>MIDI {i ? "high" : "low"}<input className={field} type="number" min={0} max={127} value={draft.range[i]} onChange={e => { const range: [number,number] = [...draft.range]; range[i] = +e.target.value; setDraft({ ...draft, range }); }} /></label>)}
          <label className="grid gap-1">Suggested BPM<input className={field} type="number" min={40} max={240} value={draft.recommendedBpm ?? ""} onChange={e => setDraft({ ...draft, recommendedBpm: e.target.value ? +e.target.value : null })} /></label>
          <label className="grid gap-1">Authored trim (dB)<input aria-label="Authored trim" className={field} type="number" min={-48} max={0} step={1} value={state.trimDb} onChange={e => state.setParam("trimDb", Math.max(-48, Math.min(0, +e.target.value)))} /></label>
          <label className="col-span-2 grid gap-1">Try this<input className={field} value={draft.tryThis} onChange={e => setDraft({ ...draft, tryThis: e.target.value })} /></label>
          <label className="col-span-2 grid gap-1">Release behavior<input className={field} value={draft.release} onChange={e => setDraft({ ...draft, release: e.target.value })} /></label>
        </div></details>
      </form>}
      <div className="flex flex-wrap gap-2">
        {!blind && <><Button variant="subtle" disabled={!current?.editable || busy} onClick={() => void perform(() => { library.rename(selected!, draft.name); setMessage("Renamed your copy; ID retained."); })}>Rename copy</Button><Button variant="subtle" disabled={!current || busy} onClick={() => void perform(async () => { await load(library.duplicate(selected!)); })}>Duplicate</Button></>}
        <Button variant="subtle" disabled={!current} onClick={() => void perform(() => jsonFile(library.exportEntry(selected!), `${auditionId(selected!)}.pack.json`))}>Export saved preset</Button>
        <Button variant="subtle" onClick={() => jsonFile(captureSound(), "current.sound.json")}>Export current sound</Button>
        <Button variant="subtle" onClick={() => file.current?.click()}>Import</Button>
        {!blind && <Button variant="subtle" disabled={!current || current.entry.id.startsWith("foundation:")} onClick={() => void perform(() => { if (window.confirm("Remove this saved sound? Export it first if you need a backup.")) { library.remove(selected!); setSelected(null); } })}>Remove saved</Button>}
      </div>
      <input ref={file} type="file" className="hidden" accept=".json,application/json" aria-label="Import preset file" onChange={e => { void importFile(e.target.files?.[0]); e.target.value = ""; }} />
      <p role="status" aria-live="polite" className="text-sm text-muted">{message || (library.available ? "Sounds are kept in this browser. Export packs for backup." : "Storage unavailable. Export to retain sounds after this visit.")}</p>
      {blind && <p className="text-xs text-muted">Blind mode hides names and authors in this panel. Exports contain provenance; reveal them after listening.</p>}
    </div>}
  </div>;
}
