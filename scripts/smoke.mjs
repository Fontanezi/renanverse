// Smoke test de integracao de ponta a ponta.
//
// Sobe 3 super peers (cluster Bully + quorum) e 2 peers de microblog, e valida:
//   - eleicao de lider (Bully) e leaderUrl;
//   - registro/descoberta de atores via super peer;
//   - follow remoto por handle;
//   - ordenacao causal por relogio vetorial no feed;
//   - pub/sub (Socket.io) para seguidores local e remoto;
//   - Update, Delete, Mention, Reject;
//   - Like/Announce sobre objeto alvo + Undo;
//   - re-sync de diretorio quando o lider retorna;
//   - quorum 2k+1 (tolera 1 falha; sem maioria recusa).
//
// Uso: `npm run smoke` (a partir da raiz do repo).

import { io } from "socket.io-client";
import {
  start, kill, killAll, killPorts, rmDbs, wait, j, idOf, dbPath, makeChecker,
} from "./_harness.mjs";

const PORTS = [3001, 3002, 4001, 4002, 4003];
const SP1 = "http://localhost:4001", SP2 = "http://localhost:4002", SP3 = "http://localhost:4003";
const A = "http://localhost:3001", B = "http://localhost:3002";
const SUPERS = `${SP1},${SP2},${SP3}`;
const checker = makeChecker();
const check = checker.check;

(async () => {
  killPorts(PORTS);
  rmDbs([dbPath("a"), dbPath("b")]);

  // Cluster de super peers.
  start("sp1", "superpeer", { SUPERPEER_ID: "1", PORT: "4001", BASE_URL: SP1, SUPERPEERS: `${SP2},${SP3}` });
  start("sp2", "superpeer", { SUPERPEER_ID: "2", PORT: "4002", BASE_URL: SP2, SUPERPEERS: `${SP1},${SP3}` });
  start("sp3", "superpeer", { SUPERPEER_ID: "3", PORT: "4003", BASE_URL: SP3, SUPERPEERS: `${SP1},${SP2}` });
  await wait(7000);

  const st1 = (await j(SP1, "/status")).body || {};
  const st2 = (await j(SP2, "/status")).body || {};
  const st3 = (await j(SP3, "/status")).body || {};
  check("Bully: lider converge para o id 3 em todos", st1.leaderId === 3 && st2.leaderId === 3 && st3.leaderId === 3,
    `sp1=${st1.leaderId} sp2=${st2.leaderId} sp3=${st3.leaderId}`);
  const leader = st3.leaderUrl || SP3;
  check("Bully: leaderUrl aponta para 4003", leader === SP3, `leaderUrl=${leader}`);

  // Peers de microblog.
  start("A", "twitter", { PEER_ID: "A", PORT: "3001", BASE_URL: A, DATABASE_PATH: dbPath("a"), SUPERPEERS: SUPERS });
  start("B", "twitter", { PEER_ID: "B", PORT: "3002", BASE_URL: B, DATABASE_PATH: dbPath("b"), SUPERPEERS: SUPERS });
  await wait(4000);

  const alice = (await j(A, "/users", "POST", { preferredUsername: "alice", name: "Alice" })).body;
  const bob = (await j(B, "/users", "POST", { preferredUsername: "bob", name: "Bob" })).body;
  const carol = (await j(A, "/users", "POST", { preferredUsername: "carol", name: "Carol" })).body;
  const aliceId = idOf(alice.id), bobId = idOf(bob.id), carolId = idOf(carol.id);
  check("peers criam Person (alice/bob/carol)", !!(aliceId && bobId && carolId));

  // Descoberta via super peer (registro coordenado por quorum; poll ate resolver).
  let aliceRes = null, bobRes = null;
  for (let i = 0; i < 16; i++) {
    aliceRes = (await j(leader, "/resolve?handle=alice@localhost:3001")).body;
    bobRes = (await j(leader, "/resolve?handle=bob@localhost:3002")).body;
    if (aliceRes && aliceRes.actorUri && bobRes && bobRes.actorUri) break;
    await wait(1000);
  }
  check("descoberta: alice@localhost:3001 resolvida no diretorio", !!(aliceRes && aliceRes.actorUri === alice.id), aliceRes && aliceRes.actorUri);
  check("descoberta: bob@localhost:3002 resolvida no diretorio", !!(bobRes && bobRes.actorUri === bob.id), bobRes && bobRes.actorUri);

  // Follows: carol -> alice (local); alice -> bob (remoto por handle); bob -> alice
  // (desde o inicio, para receber as interacoes de alice sem lacuna causal).
  await j(A, `/users/${carolId}/following`, "POST", { actorUri: alice.id });
  const fol = await j(A, `/users/${aliceId}/following`, "POST", { handle: "bob@localhost:3002" });
  check("follow remoto por handle resolvido via super peer", fol.status === 201, `status=${fol.status}`);
  await j(B, `/users/${bobId}/following`, "POST", { handle: "alice@localhost:3001" });
  await wait(2000);

  // Pub/sub: sockets em A.
  const gotAlice = [], gotCarol = [];
  const sa = io(A, { transports: ["websocket"] });
  const sc = io(A, { transports: ["websocket"] });
  await new Promise((r) => {
    let n = 0; const done = () => (++n === 2 ? r() : null);
    sa.on("connect", () => sa.emit("join", aliceId)); sa.on("joined", done);
    sc.on("connect", () => sc.emit("join", carolId)); sc.on("joined", done);
  });
  sa.on("feed:activity", (a) => gotAlice.push(a.object && a.object.content));
  sc.on("feed:activity", (a) => gotCarol.push(a.object && a.object.content));

  // Ordenacao causal: bob posta P1,P2,P3 -> alice recebe em ordem.
  await j(B, `/users/${bobId}/outbox`, "POST", { type: "Create", objectType: "Note", content: "P1" });
  await j(B, `/users/${bobId}/outbox`, "POST", { type: "Create", objectType: "Note", content: "P2" });
  await j(B, `/users/${bobId}/outbox`, "POST", { type: "Create", objectType: "Note", content: "P3" });
  await wait(2500);
  const aliceFeed = ((await j(A, `/users/${aliceId}/feed`)).body || {}).orderedItems || [];
  const contents = aliceFeed.map((x) => x.object && x.object.content);
  check("vclock: feed de alice tem P1,P2,P3 em ordem causal", JSON.stringify(contents) === JSON.stringify(["P1", "P2", "P3"]), JSON.stringify(contents));
  check("pub/sub: socket de alice recebeu os 3 posts de bob", ["P1", "P2", "P3"].every((c) => gotAlice.includes(c)), JSON.stringify(gotAlice));

  // Post local + pub/sub para seguidor local.
  const aPost = await j(A, `/users/${aliceId}/outbox`, "POST", { type: "Create", objectType: "Note", content: "post da alice" });
  const aPostId = aPost.body && aPost.body.id ? aPost.body.id.split("/activities/")[1] : null;
  await wait(1500);
  check("pub/sub: seguidor local (carol) recebeu post da alice", gotCarol.includes("post da alice"), JSON.stringify(gotCarol));

  // Update.
  await j(A, `/users/${aliceId}/activities/${aPostId}`, "PATCH", { content: "post da alice (editado)" });
  await wait(1800);
  const carolFeed1 = ((await j(A, `/users/${carolId}/feed`)).body || {}).orderedItems || [];
  const edited = carolFeed1.find((x) => x.actor === alice.id);
  check("Update: feed de carol reflete a edicao", !!edited && edited.object.content === "post da alice (editado)", edited && edited.object.content);

  // Delete.
  await j(A, `/users/${aliceId}/activities/${aPostId}`, "DELETE");
  await wait(1500);
  const carolFeed2 = ((await j(A, `/users/${carolId}/feed`)).body || {}).orderedItems || [];
  check("Delete: post removido do feed de carol", !carolFeed2.some((x) => x.actor === alice.id));

  // Mention (carol nao segue bob).
  await j(B, `/users/${bobId}/outbox`, "POST", { type: "Create", objectType: "Note", content: "oi @carol@localhost:3001" });
  await wait(2500);
  const mentions = ((await j(A, `/users/${carolId}/mentions`)).body || {}).orderedItems || [];
  check("Mention: carol (nao-seguidora) recebeu a mencao de bob", mentions.length >= 1, `mentions=${mentions.length}`);

  // Reject: bob remove alice dos seguidores.
  await j(B, `/users/${bobId}/followers`, "DELETE", { actorUri: alice.id });
  await wait(2000);
  const aliceFollowing = ((await j(A, `/users/${aliceId}/following`)).body || {}).items || [];
  check("Reject: follow alice->bob removido apos Reject", !aliceFollowing.includes(bob.id), JSON.stringify(aliceFollowing));

  // Like/Announce sobre objeto alvo, federando cross-peer (bob ja segue alice).
  const bobOut = ((await j(B, `/users/${bobId}/outbox`)).body || {}).orderedItems || [];
  const p1 = bobOut.find((x) => x.object && x.object.content === "P1");
  const p1Uri = p1 && p1.id;
  await j(A, `/users/${aliceId}/likes`, "POST", { object: p1Uri });
  await j(A, `/users/${aliceId}/announces`, "POST", { object: p1Uri });
  await wait(2500);
  // Like nao entra no feed (por design); aparece na colecao /liked do autor.
  const liked = ((await j(A, `/users/${aliceId}/liked`)).body || {}).orderedItems || [];
  check("Like sobre objeto alvo: P1 aparece em /liked de alice", liked.some((x) => x.id === p1Uri), `liked=${liked.length}`);
  // Announce (boost) aparece no feed do seguidor remoto (bob).
  const bobFeed = ((await j(B, `/users/${bobId}/feed`)).body || {}).orderedItems || [];
  const annItem = bobFeed.find((x) => x.type === "Announce" && x.actor === alice.id);
  check("Announce cross-peer: bob ve o boost de alice sobre P1", !!annItem);

  // Undo{Like}: unlike (DELETE /likes {object}) remove P1 de /liked.
  await j(A, `/users/${aliceId}/likes`, "DELETE", { object: p1Uri });
  await wait(1500);
  const liked2 = ((await j(A, `/users/${aliceId}/liked`)).body || {}).orderedItems || [];
  check("Undo{Like}: P1 sai de /liked apos unlike", !liked2.some((x) => x.id === p1Uri));

  sa.close(); sc.close();

  // Bully re-eleicao: derruba o lider (sp3) -> sp2 assume.
  kill("sp3");
  await wait(7000);
  const rst1 = (await j(SP1, "/status")).body || {};
  const rst2 = (await j(SP2, "/status")).body || {};
  check("Bully: apos queda do lider, sp2 (id 2) assume", rst1.leaderId === 2 && rst2.leaderId === 2, `sp1=${rst1.leaderId} sp2=${rst2.leaderId}`);

  // Re-sync de diretorio: paro os peers (sem re-registro) e volto sp3. Ao
  // reassumir a lideranca, sp3 (diretorio vazio no boot) ressincroniza dos pares.
  kill("A"); kill("B");
  start("sp3", "superpeer", { SUPERPEER_ID: "3", PORT: "4003", BASE_URL: SP3, SUPERPEERS: `${SP1},${SP2}` });
  let sp3resolve = null;
  for (let i = 0; i < 10; i++) {
    await wait(1000);
    const st = (await j(SP3, "/status")).body || {};
    if (st.leaderId === 3) {
      sp3resolve = (await j(SP3, "/resolve?handle=alice@localhost:3001")).body;
      if (sp3resolve && sp3resolve.actorUri) break;
    }
  }
  check("re-sync: sp3 que retornou repopula o diretorio dos pares (resolve alice)", !!(sp3resolve && sp3resolve.actorUri === alice.id), sp3resolve && sp3resolve.actorUri);

  // Quorum 2k+1: sp1,sp2,sp3 vivos (sp3 lider). Mato 1 -> commita; mato 2 -> 503.
  const reg3 = await j(SP3, "/register", "POST", { peer: "http://x", actors: [{ handle: "t@x", actorUri: "http://x/users/1" }] });
  check("quorum: 3 vivos -> registro commitado", reg3.status === 200 && reg3.body && reg3.body.committed === true, `status=${reg3.status} acks=${reg3.body && reg3.body.acks}`);
  kill("sp1");
  await wait(3000);
  const reg2 = await j(SP3, "/register", "POST", { peer: "http://x2", actors: [{ handle: "t2@x", actorUri: "http://x/users/2" }] });
  check("quorum: 2 vivos -> registro commitado (tolera 1 falha)", reg2.status === 200 && reg2.body && reg2.body.committed === true, `status=${reg2.status} acks=${reg2.body && reg2.body.acks}`);
  kill("sp2");
  await wait(3000);
  const reg1 = await j(SP3, "/register", "POST", { peer: "http://y", actors: [{ handle: "u@y", actorUri: "http://y/users/1" }] });
  check("quorum: 1 vivo -> registro recusado (503, CP)", reg1.status === 503, `status=${reg1.status}`);

  const ok = checker.fails === 0;
  console.log(`\n==== ${ok ? "TODOS OS TESTES PASSARAM" : checker.fails + " TESTE(S) FALHARAM"} ====`);
  killAll();
  await wait(500);
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("erro no smoke:", e);
  killAll();
  process.exit(1);
});
