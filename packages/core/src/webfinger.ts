// Descoberta de atores entre peers via WebFinger (RFC 7033).
//
// Permite resolver um handle "usuario@host" (ex.: alice@localhost:3001) para a
// URI canônica do ator (ex.: http://localhost:3001/users/01ABC...), sem que o
// cliente precise saber o id interno. É o que faltava para a federação ser
// "de verdade": seguir @alice@peerB conhecendo só o handle.

import type { PersonRow } from "./activitystreams";

/** Extrai o host (com porta) de um baseUrl. Ex.: "http://localhost:3001" -> "localhost:3001". */
export function hostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

/** Monta o handle "acct:usuario@host" de um Person deste peer. */
export function acctForPerson(baseUrl: string, preferredUsername: string): string {
  return `acct:${preferredUsername}@${hostFromBaseUrl(baseUrl)}`;
}

/** Interpreta o parâmetro `resource` do WebFinger. Aceita com ou sem "acct:". */
export function parseAcctResource(
  resource: string | undefined
): { username: string; host: string } | null {
  if (!resource) return null;
  const acct = resource.startsWith("acct:") ? resource.slice(5) : resource;
  const at = acct.lastIndexOf("@");
  if (at <= 0 || at === acct.length - 1) return null;
  return { username: acct.slice(0, at), host: acct.slice(at + 1) };
}

/** Monta o JRD (JSON Resource Descriptor) de um ator deste peer. */
export function buildJrd(baseUrl: string, person: PersonRow) {
  const actorUri = `${baseUrl.replace(/\/$/, "")}/users/${person.id}`;
  return {
    subject: acctForPerson(baseUrl, person.preferredUsername),
    aliases: [actorUri],
    links: [
      {
        rel: "self",
        type: "application/activity+json",
        href: actorUri,
      },
    ],
  };
}

/**
 * Ambiente reduzido: peers rodam em localhost via HTTP; hosts reais usariam
 * HTTPS. Heurística simples para montar a URL do WebFinger remoto.
 */
function schemeForHost(host: string): string {
  const bare = host.split(":")[0];
  return bare === "localhost" || bare === "127.0.0.1" ? "http" : "https";
}

/**
 * Resolve um handle "usuario@host" para a URI do ator, consultando o WebFinger
 * do peer remoto. Devolve null se não encontrar ou se a consulta falhar.
 */
export async function resolveHandleToActorUri(handle: string): Promise<string | null> {
  const parsed = parseAcctResource(handle);
  if (!parsed) return null;
  const { host } = parsed;
  const resource = `acct:${parsed.username}@${host}`;
  const url = `${schemeForHost(host)}://${host}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`;

  try {
    const res = await fetch(url, { headers: { Accept: "application/jrd+json" } });
    if (!res.ok) return null;
    const jrd = (await res.json()) as {
      links?: { rel?: string; type?: string; href?: string }[];
    };
    const self = jrd.links?.find(
      (l) => l.rel === "self" && typeof l.type === "string" && l.type.includes("activity+json")
    );
    return self?.href ?? null;
  } catch {
    return null;
  }
}
