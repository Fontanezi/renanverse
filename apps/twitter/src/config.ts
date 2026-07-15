import { z } from "zod";
import type { PlatformConfig } from "@renanverse/core";

/** Regra de negócio do Twitter: tweets curtos, tipo "Note". */
export const TWEET_MAX_CHARS = 280;

/**
 * Schema específico do microblog:
 * - objectType é sempre "Note" (não faz sentido Image/Link aqui, isso é
 *   Instagram/Reddit — o núcleo aceita qualquer string, quem restringe é o app)
 * - content é obrigatório e limitado a 280 caracteres
 * - attachmentUrl é opcional (tweet pode ter uma imagem anexada, mas não precisa)
 * - meta.inReplyTo (opcional) guarda a URI da activity respondida, pra permitir
 *   threads sem precisar mexer no schema genérico do núcleo
 */
export const twitterActivitySchema = z.object({
  type: z.enum(["Create", "Like", "Announce"]).default("Create"),
  objectType: z.literal("Note").default("Note"),
  content: z
    .string()
    .min(1, "O tweet não pode ser vazio")
    .max(TWEET_MAX_CHARS, `Tweets têm no máximo ${TWEET_MAX_CHARS} caracteres`),
  attachmentUrl: z.string().url().optional(),
  inReplyTo: z.string().url().optional(),
}).transform(({ inReplyTo, ...rest }) => ({
  ...rest,
  meta: inReplyTo ? { inReplyTo } : undefined,
}));

export const twitterConfig: PlatformConfig = {
  peerId: process.env.PEER_ID ?? "twitter-peer-local",
  displayName: "Renanverse-Twitter",
  baseUrl: process.env.BASE_URL ?? "http://localhost:3001",
  dbPath: process.env.DATABASE_PATH ?? "./twitter.db",
  port: Number(process.env.PORT ?? 3001),
  createActivitySchema: twitterActivitySchema,
};
