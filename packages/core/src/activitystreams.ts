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
  type: string;
  actorUri: string;
  objectType: string | null;
  content: string | null;
  attachmentUrl: string | null;
  /** JSON string com dados específicos da plataforma (título no Reddit,
   *  community/subreddit, filtro aplicado na foto do Instagram, etc).
   *  Cada app decide o que colocar aqui; o núcleo só guarda e devolve. */
  meta: string | null;
  lamportClock: number;
  published: string;
  raw: string;
  authorId: string | null;
}

/** Monta a URI completa de um recurso a partir do BASE_URL do peer. */
export function actorUri(baseUrl: string, personId: string): string {
  return `${baseUrl}/users/${personId}`;
}

/** Serializa um Person do banco para o objeto AS2 "Person". */
export function personToAS2(baseUrl: string, p: PersonRow) {
  const uri = actorUri(baseUrl, p.id);
  return {
    "@context": ["https://www.w3.org/ns/activitystreams"],
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
  };
}

/** Serializa uma Activity do banco para o objeto AS2 correspondente. */
export function activityToAS2(baseUrl: string, a: ActivityRow) {
  let meta: Record<string, unknown> | undefined;
  if (a.meta) {
    try {
      meta = JSON.parse(a.meta);
    } catch {
      meta = undefined;
    }
  }

  return {
    "@context": ["https://www.w3.org/ns/activitystreams"],
    id: `${baseUrl}/activities/${a.id}`,
    type: a.type,
    actor: a.actorUri,
    published: a.published,
    object: {
      type: a.objectType ?? "Note",
      content: a.content ?? undefined,
      attachment: a.attachmentUrl ?? undefined,
      // Campos extras específicos da plataforma (ex: title, community) são
      // espalhados aqui dentro do object, sem sujar o vocabulário AS2 padrão.
      ...meta,
    },
    // Campo de extensão nosso — fora do vocabulário padrão AS2, mas necessário
    // pra causalidade nas próximas fases. Peers que não conhecem, ignoram.
    _lamportClock: a.lamportClock,
  };
}
