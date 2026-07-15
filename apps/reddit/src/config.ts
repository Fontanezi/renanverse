import { z } from "zod";
import type { PlatformConfig } from "@renanverse/core";

/**
 * TODO (Reddit): regras específicas ainda por implementar.
 * Diferenças esperadas em relação ao Twitter/Instagram:
 * - objectType "Link" (post de link) ou "Page" (post de texto, tipo "self post")
 * - title OBRIGATÓRIO (Reddit é orientado a título, diferente de tweet/legenda)
 * - attachmentUrl obrigatório só quando objectType === "Link"
 * - conceito de "community" (subreddit) que NÃO existe no schema genérico —
 *   por enquanto guardamos em meta.community; se crescer, vale criar uma
 *   tabela "community" própria neste app (o núcleo não precisa saber disso)
 * - provavelmente vai precisar de um endpoint próprio tipo
 *   GET /communities/:name/outbox para listar posts de uma comunidade
 *   (isso NÃO existe ainda em lugar nenhum, precisa ser adicionado aqui)
 */
export const redditActivitySchema = z.object({
  type: z.enum(["Create", "Like", "Announce"]).default("Create"),
  objectType: z.enum(["Link", "Page"]).default("Page"),
  title: z.string().min(1, "Todo post precisa de título").max(300),
  content: z.string().optional(), // corpo do texto, se for "self post"
  attachmentUrl: z.string().url().optional(), // TODO: exigir quando objectType === "Link"
  community: z.string().min(1).default("geral"), // TODO: validar contra tabela real de communities
}).transform(({ title, community, ...rest }) => ({
  ...rest,
  meta: { title, community },
}));

export const redditConfig: PlatformConfig = {
  peerId: process.env.PEER_ID ?? "reddit-peer-local",
  displayName: "Renanverse-Reddit",
  baseUrl: process.env.BASE_URL ?? "http://localhost:3003",
  dbPath: process.env.DATABASE_PATH ?? "./reddit.db",
  port: Number(process.env.PORT ?? 3003),
  createActivitySchema: redditActivitySchema,
};
