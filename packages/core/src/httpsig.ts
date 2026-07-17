// Autenticação das entregas servidor -> servidor via HTTP Signatures
// (rascunho Cavage, o mesmo esquema que o Mastodon usa), sobre RSA-SHA256.
//
// Cada peer tem UM par de chaves RSA (persistido em kv). A chave pública é
// publicada em cada Person deste peer (campo `publicKey`). Ao entregar uma
// Activity, o dispatcher assina `(request-target) host date digest`; a inbox
// do peer de destino busca a chave pública do ator de origem e verifica.
//
// Não adiciona dependências: usa o módulo `crypto` nativo do Node.

import crypto from "node:crypto";
import type { Database } from "better-sqlite3";

const KV_PRIVATE = "rsaPrivateKeyPem";
const KV_PUBLIC = "rsaPublicKeyPem";

function kvGet(db: Database, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

function kvSet(db: Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

/** Gera o par RSA do peer na primeira vez; nas próximas, reutiliza o do kv. */
export function ensureKeyPair(db: Database): { privateKeyPem: string; publicKeyPem: string } {
  const priv = kvGet(db, KV_PRIVATE);
  const pub = kvGet(db, KV_PUBLIC);
  if (priv && pub) return { privateKeyPem: priv, publicKeyPem: pub };

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  kvSet(db, KV_PRIVATE, privateKey);
  kvSet(db, KV_PUBLIC, publicKey);
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/** Chave pública PEM do peer (para publicar no Person). */
export function publicKeyPem(db: Database): string {
  return ensureKeyPair(db).publicKeyPem;
}

/** keyId canônico da chave de um ator (convenção ActivityPub). */
export function keyIdForActor(actorUri: string): string {
  return `${actorUri}#main-key`;
}

function sha256Base64(body: string): string {
  return crypto.createHash("sha256").update(body, "utf8").digest("base64");
}

/**
 * Monta os headers de assinatura (Date, Digest, Signature) para uma entrega.
 * O `actorUri` define o keyId; a assinatura é feita com a chave privada do peer
 * (o ator sempre é local a este peer quando originamos uma Activity).
 */
export function buildSignatureHeaders(
  db: Database,
  actorUri: string,
  targetUrl: string,
  bodyString: string
): Record<string, string> {
  const { privateKeyPem } = ensureKeyPair(db);
  const url = new URL(targetUrl);
  const date = new Date().toUTCString();
  const digest = `SHA-256=${sha256Base64(bodyString)}`;

  const signingString = [
    `(request-target): post ${url.pathname}`,
    `host: ${url.host}`,
    `date: ${date}`,
    `digest: ${digest}`,
  ].join("\n");

  const signature = crypto
    .sign("sha256", Buffer.from(signingString, "utf8"), privateKeyPem)
    .toString("base64");

  const sigHeader =
    `keyId="${keyIdForActor(actorUri)}",` +
    `algorithm="rsa-sha256",` +
    `headers="(request-target) host date digest",` +
    `signature="${signature}"`;

  return { Date: date, Digest: digest, Signature: sigHeader };
}

function parseSignatureHeader(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Formato: chave="valor",chave2="valor2" (o valor pode conter vírgulas/base64).
  const re = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(header)) !== null) out[m[1]] = m[2];
  return out;
}

/** Busca a chave pública PEM de um ator remoto a partir do seu keyId. */
async function fetchActorPublicKey(keyId: string): Promise<string | null> {
  const actorUri = keyId.split("#")[0];
  try {
    const res = await fetch(actorUri, { headers: { Accept: "application/activity+json" } });
    if (!res.ok) return null;
    const actor = (await res.json()) as { publicKey?: { publicKeyPem?: string } };
    return actor.publicKey?.publicKeyPem ?? null;
  } catch {
    return null;
  }
}

export interface VerifyInput {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  rawBody: string;
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  keyId?: string;
}

/**
 * Verifica a assinatura de um request de entrega. Refaz a signing string a
 * partir dos headers recebidos, busca a chave pública do ator (keyId) e valida
 * a assinatura RSA-SHA256; também confere o Digest contra o corpo cru.
 */
export async function verifyRequest(input: VerifyInput): Promise<VerifyResult> {
  const sig = input.headers["signature"];
  if (!sig) return { ok: false, reason: "sem header Signature" };

  const parsed = parseSignatureHeader(sig);
  const { keyId, headers: signedHeaders, signature } = parsed;
  if (!keyId || !signedHeaders || !signature) {
    return { ok: false, reason: "Signature malformado" };
  }

  // Confere o Digest do corpo, se estiver entre os headers assinados.
  const digestHeader = input.headers["digest"];
  if (signedHeaders.includes("digest")) {
    const expected = `SHA-256=${sha256Base64(input.rawBody)}`;
    if (digestHeader !== expected) {
      return { ok: false, reason: "Digest nao confere com o corpo", keyId };
    }
  }

  // Refaz a signing string na ordem declarada em `headers`.
  const lines: string[] = [];
  for (const h of signedHeaders.split(" ")) {
    if (h === "(request-target)") {
      lines.push(`(request-target): ${input.method.toLowerCase()} ${input.path}`);
    } else {
      lines.push(`${h}: ${input.headers[h] ?? ""}`);
    }
  }
  const signingString = lines.join("\n");

  const publicKey = await fetchActorPublicKey(keyId);
  if (!publicKey) return { ok: false, reason: "chave publica do ator nao encontrada", keyId };

  try {
    const ok = crypto.verify(
      "sha256",
      Buffer.from(signingString, "utf8"),
      publicKey,
      Buffer.from(signature, "base64")
    );
    return ok ? { ok: true, keyId } : { ok: false, reason: "assinatura invalida", keyId };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "erro ao verificar", keyId };
  }
}
