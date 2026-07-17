import { z } from "zod";
import type { PlatformConfig } from "@renanverse/core";

/** Legenda (caption) do Instagram: limite generoso, como no produto real. */
export const CAPTION_MAX_CHARS = 2200;

/**
 * Regra de negócio do Instagram: postagem é sempre uma imagem.
 * - objectType é sempre "Image".
 * - attachmentUrl é OBRIGATÓRIO (não existe post sem imagem); a mensagem
 *   distingue "campo ausente" de "URL inválida".
 * - content é a legenda (caption), opcional, até 2200 caracteres.
 * - meta.altText (texto alternativo de acessibilidade) e meta.filter (filtro
 *   aplicado) são opcionais e guardados no campo livre `meta` do núcleo.
 */
export const instagramActivitySchema = z.object({
  type: z.enum(["Create", "Like", "Announce"]).default("Create"),
  objectType: z.literal("Image").default("Image"),
  content: z
    .string()
    .max(CAPTION_MAX_CHARS, `A legenda tem no máximo ${CAPTION_MAX_CHARS} caracteres`)
    .optional(),
  attachmentUrl: z
    .string({ required_error: "Toda postagem do Instagram precisa de uma imagem (attachmentUrl)" })
    .url("attachmentUrl deve ser uma URL de imagem válida"),
  altText: z.string().max(1000, "O texto alternativo é muito longo").optional(),
  filter: z.string().optional(),
}).transform(({ altText, filter, ...rest }) => ({
  ...rest,
  meta: altText || filter ? { altText, filter } : undefined,
}));

export const instagramConfig: PlatformConfig = {
  peerId: process.env.PEER_ID ?? "instagram-peer-local",
  displayName: "Renanverse-Instagram",
  baseUrl: process.env.BASE_URL ?? "http://localhost:3002",
  dbPath: process.env.DATABASE_PATH ?? "./instagram.db",
  port: Number(process.env.PORT ?? 3002),
  createActivitySchema: instagramActivitySchema,
};
