import { z } from "zod";
import type { PlatformConfig } from "@renanverse/core";

/**
 * TODO (Instagram): regras específicas ainda por implementar.
 * Diferenças esperadas em relação ao Twitter:
 * - objectType fixo em "Image" (em vez de "Note")
 * - attachmentUrl OBRIGATÓRIO (toda postagem tem que ter uma imagem)
 * - content vira a legenda (caption), pode ser mais longo, ou até opcional
 * - meta pode guardar { altText, filter } (texto alternativo, filtro aplicado)
 *
 * O schema abaixo é um placeholder próximo do Twitter só para o app subir;
 * ajuste-o quando for implementar o Instagram de verdade.
 */
export const instagramActivitySchema = z.object({
  type: z.enum(["Create", "Like", "Announce"]).default("Create"),
  objectType: z.literal("Image").default("Image"),
  content: z.string().max(2200, "Legenda muito longa").optional(), // caption
  attachmentUrl: z.string().url("A URL da imagem é obrigatória"), // TODO: tornar obrigatório de fato (não .optional())
}).transform((data) => ({ ...data, meta: undefined }));

export const instagramConfig: PlatformConfig = {
  peerId: process.env.PEER_ID ?? "instagram-peer-local",
  displayName: "Renanverse-Instagram",
  baseUrl: process.env.BASE_URL ?? "http://localhost:3002",
  dbPath: process.env.DATABASE_PATH ?? "./instagram.db",
  port: Number(process.env.PORT ?? 3002),
  createActivitySchema: instagramActivitySchema,
};
