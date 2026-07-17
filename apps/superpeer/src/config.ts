/**
 * Configuração de um super peer. O `id` numérico é o que decide a eleição
 * Bully (maior ID vence). `peers` são os OUTROS super peers do cluster.
 */
export interface SuperPeerConfig {
  id: number;
  baseUrl: string;
  port: number;
  peers: string[];
}

export const superPeerConfig: SuperPeerConfig = {
  id: Number(process.env.SUPERPEER_ID ?? 1),
  baseUrl: process.env.BASE_URL ?? "http://localhost:4001",
  port: Number(process.env.PORT ?? 4001),
  peers: (process.env.SUPERPEERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
