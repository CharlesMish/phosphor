#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const urlPath = "/phosphor/";
const portRangeStart = 4300;
const portRangeSize = 1000;
const metadataName = "phosphor-lab.json";

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });

  // Some restricted shells report an EPERM wrapper error even when the child
  // ran and returned a real status. A missing status means it truly failed.
  if (result.error && result.status === null) throw result.error;
  return result;
}

function git(args, options = {}) {
  return command("git", args, options);
}

function gitOutput(args) {
  const result = git(args);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function worktrees() {
  const output = gitOutput(["worktree", "list", "--porcelain"]);
  return output.split(/\r?\n\r?\n/).map((record) => {
    const entry = {};
    for (const field of record.split(/\r?\n/)) {
      const separator = field.indexOf(" ");
      const key = separator === -1 ? field : field.slice(0, separator);
      const value = separator === -1 ? true : field.slice(separator + 1);
      if (key === "worktree") entry.path = value;
      if (key === "branch") entry.branch = value.replace(/^refs\/heads\//, "");
      if (key === "detached") entry.branch = "(detached)";
    }
    return entry;
  }).filter((entry) => entry.path);
}

function predictablePort(branch) {
  const digest = createHash("sha256").update(branch).digest();
  return portRangeStart + (digest.readUInt16BE(0) % portRangeSize);
}

function browserUrl(port) {
  return `http://localhost:${port}${urlPath}`;
}

function metadataPath(worktreePath) {
  return path.join(worktreePath, ".vite", metadataName);
}

async function readMetadata(worktreePath) {
  try {
    return JSON.parse(await readFile(metadataPath(worktreePath), "utf8"));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function portIsAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function activeLab(entry) {
  const metadata = await readMetadata(entry.path);
  if (
    metadata?.branch === entry.branch &&
    Number.isInteger(metadata.port) &&
    processIsAlive(metadata.pid) &&
    !(await portIsAvailable(metadata.port))
  ) {
    return metadata;
  }
  return null;
}

function safePathSegment(segment) {
  return segment.replace(/[<>:"\\|?*]/g, "-");
}

function persistentPath(branch) {
  const parent = path.join(
    path.dirname(repoRoot),
    `${path.basename(repoRoot)}-worktrees`,
  );
  return path.join(parent, ...branch.split("/").map(safePathSegment));
}

function refExists(ref) {
  return git(["show-ref", "--verify", "--quiet", ref]).status === 0;
}

async function findOrCreateWorktree(branch) {
  const existing = worktrees().find((entry) => entry.branch === branch);
  if (existing) {
    if (!existsSync(existing.path)) {
      throw new Error(
        `Git records ${branch} at missing path ${existing.path}. Repair or prune that worktree first.`,
      );
    }
    console.log(`Using existing worktree: ${existing.path}`);
    return existing;
  }

  const validation = git(["check-ref-format", "--branch", branch]);
  if (validation.status !== 0) throw new Error(`Invalid branch name: ${branch}`);

  const targetPath = persistentPath(branch);
  await mkdir(path.dirname(targetPath), { recursive: true });

  let args;
  if (refExists(`refs/heads/${branch}`)) {
    args = ["worktree", "add", targetPath, branch];
  } else if (refExists(`refs/remotes/origin/${branch}`)) {
    args = ["worktree", "add", "--track", "-b", branch, targetPath, `origin/${branch}`];
  } else {
    throw new Error(
      `Branch ${branch} was not found locally or at origin/${branch}. Fetch or create it explicitly first.`,
    );
  }

  console.log(`Creating persistent worktree: ${targetPath}`);
  const result = git(args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Could not create a worktree for ${branch}.`);
  return { branch, path: targetPath };
}

function dependenciesAreReady(worktreePath) {
  if (!existsSync(path.join(worktreePath, "node_modules"))) return false;
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  return command(npm, ["ls", "--depth=0", "--silent"], {
    cwd: worktreePath,
    stdio: "ignore",
  }).status === 0;
}

function ensureDependencies(worktreePath) {
  if (dependenciesAreReady(worktreePath)) return;

  console.log("Installing dependencies (without creating a package lock)...");
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = command(npm, ["install", "--no-package-lock"], {
    cwd: worktreePath,
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error("npm install failed.");
}

async function choosePort(branch) {
  const preferred = predictablePort(branch);
  for (let offset = 0; offset < 50; offset += 1) {
    const port = preferred + offset;
    if (await portIsAvailable(port)) return { port, preferred };
  }
  throw new Error(`No available port found near ${preferred}.`);
}

async function listLabs() {
  const entries = worktrees();
  const rows = [];

  for (const entry of entries) {
    const branch = entry.branch ?? "(unknown)";
    const active = await activeLab(entry);
    const port = active?.port ?? predictablePort(branch);
    let status = "running";
    if (!active) status = (await portIsAvailable(port)) ? "ready" : "port occupied";
    rows.push({ BRANCH: branch, WORKTREE: entry.path, URL: browserUrl(port), STATUS: status });
  }

  console.table(rows);
}

async function startLab(branch) {
  const entry = await findOrCreateWorktree(branch);
  const active = await activeLab(entry);
  if (active) {
    console.log(`Already running: ${browserUrl(active.port)}`);
    return;
  }

  ensureDependencies(entry.path);
  const { port, preferred } = await choosePort(branch);
  if (port !== preferred) console.log(`Port ${preferred} is occupied; using ${port}.`);

  const vitePackagePath = path.join(entry.path, "node_modules", "vite", "package.json");
  const vitePackage = JSON.parse(await readFile(vitePackagePath, "utf8"));
  const viteBin = typeof vitePackage.bin === "string" ? vitePackage.bin : vitePackage.bin?.vite;
  if (!viteBin) throw new Error("The installed Vite package has no executable.");

  const token = randomUUID();
  const metadataFile = metadataPath(entry.path);
  await mkdir(path.dirname(metadataFile), { recursive: true });

  console.log("\nOpen this URL:");
  console.log(`  ${browserUrl(port)}\n`);
  console.log(`Starting Vite for ${branch} in ${entry.path}`);

  const child = spawn(
    process.execPath,
    [path.resolve(entry.path, "node_modules", "vite", viteBin), "--host", "0.0.0.0", "--port", String(port), "--strictPort"],
    { cwd: entry.path, stdio: "inherit" },
  );
  const childExit = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let receivedSignal;
  const stop = (signal) => {
    receivedSignal = signal;
    if (!child.killed) child.kill(signal);
  };
  const stopOnInterrupt = () => stop("SIGINT");
  const stopOnTerminate = () => stop("SIGTERM");
  process.once("SIGINT", stopOnInterrupt);
  process.once("SIGTERM", stopOnTerminate);

  try {
    await writeFile(
      metadataFile,
      `${JSON.stringify({ branch, path: entry.path, port, pid: child.pid, token }, null, 2)}\n`,
    );
    const result = await childExit;
    process.exitCode = result.code ?? (receivedSignal === "SIGINT" ? 130 : 1);
  } finally {
    process.off("SIGINT", stopOnInterrupt);
    process.off("SIGTERM", stopOnTerminate);
    const latest = await readMetadata(entry.path);
    if (latest?.token === token) await rm(metadataFile, { force: true });
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
}

async function main() {
  const [argument, ...extra] = process.argv.slice(2);
  if (extra.length > 0) throw new Error("Pass exactly one branch name.");
  if (argument === "--list") return listLabs();
  if (!argument) {
    throw new Error("Usage: npm run lab -- <branch>\n       npm run lab:list");
  }
  return startLab(argument);
}

main().catch((error) => {
  console.error(`\nLab error: ${error.message}`);
  process.exitCode = 1;
});
