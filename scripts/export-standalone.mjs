import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

// Run after npm run build. Keep the comparison playable from a single local file.
const project = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = resolve(process.argv[2] || resolve(project, "dist/phosphor-panel-lanes.html"));
let html = await readFile(resolve(project, "dist/index.html"), "utf8");
const script = html.match(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/);
const style = html.match(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/);
if (!script || !style) throw new Error("Expected one script and stylesheet in the Vite build");
const js = await readFile(resolve(project, "dist/assets", basename(script[1])), "utf8");
const css = await readFile(resolve(project, "dist/assets", basename(style[1])), "utf8");
if (/\bimport\s*\(/.test(js)) throw new Error("Bundle contains split imports; inline those before exporting");
html = html.replace(script[0], () => `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace(style[0], () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
const favicon = await readFile(resolve(project, "public/favicon.svg"));
html = html.replace('href="./favicon.svg"', `href="data:image/svg+xml;base64,${favicon.toString("base64")}"`);

const fontLink = html.match(/<link\b[^>]*href="(https:\/\/fonts.googleapis.com[^\"]+)"[^>]*>/);
if (fontLink) {
  const response = await fetch(fontLink[1].replaceAll("&amp;", "&"), { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Font stylesheet download failed (${response.status})`);
  let fontCss = await response.text();
  const urls = [...new Set([...fontCss.matchAll(/url\((https:\/\/fonts.gstatic.com\/[^)]+)\)/g)].map((match) => match[1]))];
  for (const url of urls) {
    const font = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!font.ok) throw new Error(`Font download failed (${font.status})`);
    const mime = url.endsWith(".ttf") ? "font/ttf" : "font/woff2";
    const data = Buffer.from(await font.arrayBuffer()).toString("base64");
    fontCss = fontCss.replaceAll(url, `data:${mime};base64,${data}`);
  }
  html = html.replace(fontLink[0], () => `<style>${fontCss}</style>`);
  html = html.replace(/\s*<link[^>]*rel="preconnect"[^>]*>/g, "");
}
html = html.replace("<title>Phosphor</title>", "<title>Phosphor — three panel studies</title>");
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, html);
console.log(`Saved ${destination} (${Buffer.byteLength(html)} bytes)`);
