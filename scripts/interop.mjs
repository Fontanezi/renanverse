// Teste de interoperabilidade entre as TRES plataformas.
//
// Sobe Twitter (microblog), Instagram (imagens) e Reddit (links/texto) e valida
// que conteudo de plataformas diferentes federa para o feed de um peer, via
// descoberta por WebFinger (sem super peers). Confirma que o nucleo de federacao
// e agnostico de plataforma: a validacao de schema roda so na publicacao local.
//
// Uso: `npm run interop` (a partir da raiz do repo).

import { start, killAll, killPorts, rmDbs, wait, j, idOf, dbPath, makeChecker } from "./_harness.mjs";

const PORTS = [3001, 3002, 3003];
const TW = "http://localhost:3001", IG = "http://localhost:3002", RD = "http://localhost:3003";
const checker = makeChecker();
const check = checker.check;

(async () => {
  killPorts(PORTS);
  rmDbs([dbPath("tw"), dbPath("ig"), dbPath("rd")]);

  start("tw", "twitter", { PEER_ID: "tw", PORT: "3001", BASE_URL: TW, DATABASE_PATH: dbPath("tw") });
  start("ig", "instagram", { PEER_ID: "ig", PORT: "3002", BASE_URL: IG, DATABASE_PATH: dbPath("ig") });
  start("rd", "reddit", { PEER_ID: "rd", PORT: "3003", BASE_URL: RD, DATABASE_PATH: dbPath("rd") });
  await wait(4500);

  const joao = (await j(TW, "/users", "POST", { preferredUsername: "joao", name: "Joao" })).body;
  const ana = (await j(IG, "/users", "POST", { preferredUsername: "ana", name: "Ana" })).body;
  const link = (await j(RD, "/users", "POST", { preferredUsername: "link", name: "Link" })).body;
  check("cria Person nas 3 plataformas", !!(joao && ana && link && joao.id && ana.id && link.id));

  // joao (twitter) segue ana (instagram) e link (reddit) por handle (WebFinger).
  const f1 = await j(TW, `/users/${idOf(joao.id)}/following`, "POST", { handle: "ana@localhost:3002" });
  const f2 = await j(TW, `/users/${idOf(joao.id)}/following`, "POST", { handle: "link@localhost:3003" });
  check("twitter segue instagram por handle (WebFinger)", f1.status === 201, `status=${f1.status}`);
  check("twitter segue reddit por handle (WebFinger)", f2.status === 201, `status=${f2.status}`);
  await wait(2000);

  // Instagram publica uma imagem; Reddit publica um post de texto (Page).
  await j(IG, `/users/${idOf(ana.id)}/outbox`, "POST", { type: "Create", attachmentUrl: "http://img.example/foto.jpg", content: "minha foto" });
  await j(RD, `/users/${idOf(link.id)}/outbox`, "POST", { type: "Create", objectType: "Page", title: "Meu post no reddit", content: "corpo do texto", community: "geral" });
  await wait(2800);

  // O feed do peer de microblog mostra conteudo das outras DUAS plataformas.
  const feed = ((await j(TW, `/users/${idOf(joao.id)}/feed`)).body || {}).orderedItems || [];
  const fromIg = feed.find((x) => x.actor === ana.id);
  const fromRd = feed.find((x) => x.actor === link.id);
  check("interop: post de IMAGEM do Instagram aparece no feed do Twitter", !!fromIg && fromIg.object && fromIg.object.content === "minha foto", fromIg && fromIg.object && fromIg.object.type);
  check("interop: post de TEXTO do Reddit aparece no feed do Twitter", !!fromRd && fromRd.object && fromRd.object.title === "Meu post no reddit", fromRd && fromRd.object && fromRd.object.title);

  // Endpoint especifico do Reddit (mountExtraRoutes).
  const comm = ((await j(RD, "/communities/geral/outbox")).body || {}).orderedItems || [];
  check("reddit: /communities/geral/outbox lista o post", comm.length >= 1, `itens=${comm.length}`);

  const ok = checker.fails === 0;
  console.log(`\n==== ${ok ? "INTEROP OK (3 plataformas)" : checker.fails + " TESTE(S) FALHARAM"} ====`);
  killAll();
  await wait(500);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("erro no interop:", e);
  killAll();
  process.exit(1);
});
