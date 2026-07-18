// Modelos e serialização no formato Activity Streams (AS2), conforme o
// exemplo do README do projeto. Aqui ficam só os tipos + funções puras de
// serialização — nada de acesso a banco. Compartilhado pelos 3 apps.

export interface PersonRow {
  id: string;
  preferredUsername: string;
  name: string;
  summary: string | null;
  icon: string | null;
  createdAt: string;
}

export interface ActivityRow {
  id: string;
  /** URI canônica global da Activity (AS2 "id"). Para activities locais é
   *  `${baseUrl}/activities/${id}`; para remotas, é o id vindo da origem. */
  uri: string | null;
  type: string;
  actorUri: string;
  objectType: string | null;
  content: string | null;
  attachmentUrl: string | null;
  /** JSON string com dados específicos da plataforma (título no Reddit,
   *  community/subreddit, filtro aplicado na foto do Instagram, etc).
   *  Cada app decide o que colocar aqui; o núcleo só guarda e devolve. */
  meta: string | null;
  /** URI da Activity da qual esta depende causalmente (ex.: resposta a um post). */
  inReplyTo: string | null;
  lamportClock: number;
  /** 1 = criada neste peer; 0 = recebida de outro peer via federação. */
  isLocal: number;
  published: string;
  raw: string;
  authorId: string | null;
}

/** Monta a URI completa de um recurso a partir do BASE_URL do peer. */
export function actorUri(baseUrl: string, personId: string): string {
  return `${baseUrl}/users/${personId}`;
}

/**
 * Serializa um Person do banco para o objeto AS2 "Person". Quando `publicKeyPem`
 * é informado, publica o bloco `publicKey` (usado pela verificação de
 * HTTP Signatures do peer que recebe as entregas deste ator).
 */
export function personToAS2(baseUrl: string, p: PersonRow, publicKeyPem?: string) {
  const uri = actorUri(baseUrl, p.id);
  return {
    "@context": publicKeyPem
      ? ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"]
      : ["https://www.w3.org/ns/activitystreams"],
    type: "Person",
    id: uri,
    preferredUsername: p.preferredUsername,
    name: p.name,
    summary: p.summary ?? undefined,
    icon: p.icon ? [p.icon] : undefined,
    following: `${uri}/following`,
    followers: `${uri}/followers`,
    inbox: `${uri}/inbox`,
    outbox: `${uri}/outbox`,
    publicKey: publicKeyPem
      ? { id: `${uri}#main-key`, owner: uri, publicKeyPem }
      : undefined,
  };
}

/** Serializa uma Activity do banco para o objeto AS2 correspondente. */
export function activityToAS2(baseUrl: string, a: ActivityRow, repost?: ActivityRow, actorName?: string) {
  let meta: Record<string, unknown> | undefined;
  if (a.meta) {
    try {
      meta = JSON.parse(a.meta);
    } catch {
      meta = undefined;
    }
  }

  const base = {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: a.uri ?? `${baseUrl}/activities/${a.id}`,
    type: a.type,
    actor: a.actorUri,
    actorName,
    published: a.published,
  };

  if (a.type === "Announce" && repost) {
    let repostMeta: Record<string, unknown> | undefined;
    if (repost.meta) {
      try { repostMeta = JSON.parse(repost.meta); } catch { repostMeta = undefined; }
    }

    return {
      ...base,
      object: {
        type: repost.objectType ?? "Note",
        content: repost.content ?? undefined,
        attachment: repost.attachmentUrl ?? undefined,
        inReplyTo: repost.inReplyTo ?? undefined,
        ...repostMeta,
      },
      repostOf: repost.actorUri,
      _lamportClock: a.lamportClock,
    };
  }

  return {
    ...base,
    object: {
      type: a.objectType ?? "Note",
      content: a.content ?? undefined,
      attachment: a.attachmentUrl ?? undefined,
      inReplyTo: a.inReplyTo ?? undefined,
      // Campos extras específicos da plataforma (ex: title, community) são
      // espalhados aqui dentro do object, sem sujar o vocabulário AS2 padrão.
      ...meta,
    },
    // Campo de extensão nosso — fora do vocabulário padrão AS2, mas necessário
    // pra causalidade na federação. Peers que não conhecem, ignoram.
    _lamportClock: a.lamportClock,
  };
}
