import type { ZodType, ZodTypeDef } from "zod";
import type { Express } from "express";
import type { Database } from "better-sqlite3";

/**
 * Formato normalizado que a validação de cada app deve produzir,
 * não importa quão diferente seja o body aceito por fora.
 *
 * - Twitter:   { type, objectType: "Note",  content, attachmentUrl? }
 * - Instagram: { type, objectType: "Image", content, attachmentUrl (obrigatório) }
 * - Reddit:    { type, objectType: "Link"|"Page", content?, attachmentUrl,
 *                meta: { title, community } }
 */
export interface ActivityInput {
  type: "Create" | "Like" | "Announce";
  objectType: string;
  content?: string;
  attachmentUrl?: string;
  meta?: Record<string, unknown>;
}

export interface PlatformConfig {
  /** Identificador curto do peer, ex: "twitter-peer-1" */
  peerId: string;
  /** Nome amigável exibido em GET / , ex: "Renanverse-Twitter" */
  displayName: string;
  /** URL pública deste peer, usada para montar URIs (actorUri, ids de activity) */
  baseUrl: string;
  /** Caminho do arquivo sqlite deste peer */
  dbPath: string;
  /** Porta HTTP */
  port: number;
  /**
   * Schema zod que valida e normaliza o body de POST /users/:id/outbox
   * para o formato ActivityInput. É AQUI que cada plataforma define suas
   * próprias regras (limite de caracteres, campos obrigatórios, etc).
   *
   * O terceiro parâmetro (tipo de entrada) é `unknown` de propósito: o schema
   * recebe o body cru da requisição e o normaliza para ActivityInput. Sem isso,
   * schemas com `.default()`/`.transform()` (cujo tipo de entrada torna alguns
   * campos opcionais) não seriam atribuíveis a este campo.
   */
  createActivitySchema: ZodType<ActivityInput, ZodTypeDef, unknown>;
  /**
   * Hook opcional para o app registrar rotas próprias, específicas da
   * plataforma, sem alterar o núcleo. Chamado por `createApp` depois de montar
   * as rotas genéricas, com o `Express` e o `Database` já prontos.
   *
   * Ex.: o Reddit usa isto para expor `GET /communities/:name/outbox`, que não
   * faz sentido no Twitter nem no Instagram.
   */
  mountExtraRoutes?: (app: Express, db: Database) => void;
}
