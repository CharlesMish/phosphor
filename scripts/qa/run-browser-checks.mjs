import { spawn } from "node:child_process";

const port = 9334;
const appUrl = process.argv[2] ?? "http://127.0.0.1:8080/phosphor/";
const qaUrl = new URL("scripts/qa/phrase-render.html", appUrl).href;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      /* Chrome is still starting. */
    }
    await delay(200);
  }
  throw new Error("Chrome did not open a debugging port.");
}

const chrome = spawn("google-chrome", [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--no-first-run",
  "--disable-dev-shm-usage",
  "--autoplay-policy=no-user-gesture-required",
  `--remote-debugging-port=${port}`,
  "--user-data-dir=/tmp/phosphor-qa-profile",
  "about:blank",
], { stdio: "ignore" });

function send(ws, method, params = {}) {
  const id = send.next++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), 20000);
    send.pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
send.next = 1;
send.pending = new Map();

try {
  await waitForJson();
  const created = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(qaUrl)}`, { method: "PUT" });
  const createdText = await created.text();
  let targets;
  try {
    targets = JSON.parse(createdText);
  } catch (error) {
    console.error(created.status, createdText.slice(0, 500));
    throw error;
  }
  const ws = new WebSocket(targets.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && send.pending.has(message.id)) {
      const resolve = send.pending.get(message.id);
      send.pending.delete(message.id);
      resolve(message);
    }
  });
  await send(ws, "Runtime.enable");
  let title = "";
  for (let attempt = 0; attempt < 180; attempt++) {
    const evaluated = await send(ws, "Runtime.evaluate", { expression: "document.title", returnByValue: true });
    title = evaluated.result.value;
    if (title === "PHRASE_OK" || title === "PHRASE_FAIL") break;
    await delay(1000);
  }
  const body = await send(ws, "Runtime.evaluate", {
    expression: "document.querySelector('#result').textContent",
    returnByValue: true,
  });
  console.log(body.result.value);
  if (title !== "PHRASE_OK") process.exitCode = 1;

  await send(ws, "Page.enable");
  await send(ws, "Page.navigate", { url: appUrl });
  await delay(1200);
  await send(ws, "Runtime.evaluate", { expression: "localStorage.clear()", returnByValue: true });
  await send(ws, "Page.reload", { ignoreCache: true });
  await delay(1500);
  const ui = await send(ws, "Runtime.evaluate", {
    expression: `(() => {
      const text = document.body.innerText;
      const status = document.querySelector('#phrase-render-status')?.textContent ?? '';
      const session = document.querySelector('#session-status')?.textContent ?? '';
      return JSON.stringify({
        hasPolicy: status.includes('Render from start') && status.includes('Ordinary Play'),
        hasSession: Boolean(document.querySelector('[aria-label="Session"]')),
        audition: document.querySelector('[aria-label="Audition from start"]')?.disabled ?? null,
        exportDisabled: document.querySelector('[aria-label="Export phrase WAV"]')?.disabled ?? null,
        session,
        mentionsRecorder: /live-performance recorder|record performance/i.test(text),
      });
    })()`,
    returnByValue: true,
  });
  console.log("UI", ui.result.value);
  const uiReport = JSON.parse(ui.result.value);
  if (!uiReport.hasPolicy || !uiReport.hasSession || uiReport.audition !== true || uiReport.mentionsRecorder) {
    console.error("The instrument page did not show render-from-start controls.");
    process.exitCode = 1;
  }

  async function center(label) {
    const found = await send(ws, "Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector('[aria-label="${label}"]');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      })()`,
      returnByValue: true,
    });
    return found.result.value;
  }
  async function click(label) {
    const point = await center(label);
    if (!point) throw new Error(`Missing ${label}`);
    await send(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await send(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  await click("Record note loop");
  const key = await center("C3");
  await send(ws, "Input.dispatchMouseEvent", { type: "mousePressed", x: key.x, y: key.y, button: "left", clickCount: 1 });
  await delay(180);
  await send(ws, "Input.dispatchMouseEvent", { type: "mouseReleased", x: key.x, y: key.y, button: "left", clickCount: 1 });
  let loopText = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    await delay(250);
    const sampled = await send(ws, "Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    });
    loopText = sampled.result.value;
    if (loopText.includes("Looping")) break;
  }
  await delay(800);
  console.log("After record:", loopText.includes("Looping") ? "Looping" : loopText.slice(0, 400));
  await send(ws, "Page.reload", { ignoreCache: true });
  await delay(1500);
  const restored = await send(ws, "Runtime.evaluate", {
    expression: `JSON.stringify({
      statuses: [...document.querySelectorAll('[role="status"]')].map((node) => node.textContent),
      session: document.querySelector("#session-status")?.textContent ?? "",
      stored: (() => { try { return JSON.parse(localStorage.getItem("phosphor.session.v1")).noteLoop.events.length; } catch { return null; } })(),
    })`,
    returnByValue: true,
  });
  console.log("After reload:", restored.result.value);
  const reloadReport = JSON.parse(restored.result.value);
  const restoredTake = Array.isArray(reloadReport.statuses) && reloadReport.statuses.includes("Stopped")
    && reloadReport.session.includes("restored")
    && reloadReport.stored > 0;
  if (!loopText.includes("Looping") || !restoredTake) {
    console.error("The live page did not restore a recorded take. Headless audio may not have advanced.");
    process.exitCode = 1;
  }
  ws.close();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  chrome.kill();
}
