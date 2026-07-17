// Harness compartilhado dos smoke tests de integracao.
//
// Sobe peers/super peers como processos filhos (`node --import tsx`, processo
// unico para poder mata-los por pid), faz chamadas HTTP e agrega asserções.
// Nao depende de servico externo: cada teste sobe e derruba a topologia inteira.
//
// Requisitos: Node 20+, `lsof` disponivel (Unix/macOS) para liberar portas.

import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do repositorio (scripts/ fica um nivel abaixo). */
export const REPO = path.resolve(__dirname, "..");
const LOGDIR = path.join(os.tmpdir(), "renanverse-smoke-logs");
fs.mkdirSync(LOGDIR, { recursive: true });

const procs = {};

/** Caminho de um banco temporario isolado para o teste. */
export function dbPath(name) {
  return path.join(os.tmpdir(), `renanverse-smoke-${name}.db`);
}

/**
 * Sobe um app (`apps/<app>`) como processo. Usa `node --import tsx` de proposito
 * (processo unico): assim o pid retornado E o servidor e `kill(pid)` o encerra
 * de fato. Um wrapper (npx) deixaria o processo neto vivo.
 */
export function start(name, app, env) {
  const out = fs.openSync(path.join(LOGDIR, `${name}.log`), "w");
  procs[name] = spawn("node", ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(REPO, "apps", app),
    env: { ...process.env, ...env },
    stdio: ["ignore", out, out],
  });
}

export function kill(name) {
  if (procs[name]) {
    try { procs[name].kill("SIGKILL"); } catch { /* ja morto */ }
    delete procs[name];
  }
}

export function killAll() {
  for (const n of Object.keys(procs)) kill(n);
}

/** Libera portas presas por execucoes anteriores (best-effort). */
export function killPorts(ports) {
  for (const p of ports) {
    try { execSync(`lsof -ti tcp:${p} | xargs kill -9`, { stdio: "ignore" }); } catch { /* nada na porta */ }
  }
}

/** Remove arquivos de banco (inclui -wal/-shm do WAL). */
export function rmDbs(files) {
  for (const f of files) {
    for (const suf of ["", "-wal", "-shm"]) {
      try { fs.rmSync(f + suf, { force: true }); } catch { /* ignora */ }
    }
  }
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET/POST JSON com timeout; devolve { status, body } (status 0 em falha de rede). */
export async function j(base, p, method = "GET", body) {
  try {
    const res = await fetch(base + p, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

/** Extrai o id do Person a partir da URI do ator. */
export const idOf = (u) => u.split("/users/")[1];

/** Agregador de asserções: check(nome, condicao, extra?) e contagem de falhas. */
export function makeChecker() {
  let fails = 0;
  const check = (name, cond, extra = "") => {
    console.log(`${cond ? "[PASS]" : "[FAIL]"} ${name}${extra ? "  (" + extra + ")" : ""}`);
    if (!cond) fails += 1;
  };
  return {
    check,
    get fails() { return fails; },
  };
}
