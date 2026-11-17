// Garante que o painel nunca abre conexões duplicadas na Evolution API.
// (Na Evolution, /instance/connect com estado "close" cria uma conexão nova sem fechar a anterior;
// duas conexões da mesma sessão ficam se derrubando: "conflict: replaced".)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { criarEvolution } from '../src/evolution.js';

async function evolutionFalsa(estados) {
  const chamadas = [];
  let i = 0;
  const estadoAtual = () => estados[Math.min(i, estados.length - 1)];
  const srv = http.createServer((req, res) => {
    chamadas.push(req.url);
    let corpo = { ok: true };
    if (req.url.startsWith('/instance/connectionState/')) { corpo = { instance: { state: estadoAtual() } }; i++; }
    if (req.url.startsWith('/instance/connect/')) corpo = estadoAtual() === 'connecting' ? { base64: 'data:image/png;base64,QR' } : { instance: { state: estadoAtual() } };
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(corpo));
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const wa = criarEvolution({ url: `http://127.0.0.1:${srv.address().port}`, apiKey: 'x', instancia: 'escola', webhookUrl: 'http://app/webhook' });
  return { wa, chamadas, fechar: () => srv.close() };
}
const conexoes = c => c.filter(u => u.startsWith('/instance/connect/')).length;

test('renovar o QR com o WhatsApp caído não abre conexão nova', async () => {
  const f = await evolutionFalsa(['close']);
  const r = await f.wa.conectar({ renovar: true });
  assert.equal(r.qr, null);
  assert.equal(conexoes(f.chamadas), 0);
  f.fechar();
});

test('já conectado: não chama /instance/connect', async () => {
  const f = await evolutionFalsa(['open']);
  assert.equal((await f.wa.conectar()).estado, 'open');
  assert.equal(conexoes(f.chamadas), 0);
  f.fechar();
});

test('reconexão automática da Evolution em andamento: espera e não duplica', async () => {
  // close (instante da reconexão) → open (a própria Evolution reconectou)
  const f = await evolutionFalsa(['close', 'close', 'open']);
  assert.equal((await f.wa.conectar()).estado, 'open');
  assert.equal(conexoes(f.chamadas), 0);
  f.fechar();
});

test('desconectado de verdade: abre uma conexão só e devolve o QR', async () => {
  const f = await evolutionFalsa(['close', 'close', 'close', 'connecting']);
  const r = await f.wa.conectar();
  assert.ok(r.qr);
  // 1 chamada abre a conexão (estado close) + leituras do QR só com estado "connecting"
  const abriu = f.chamadas.filter((u, k) => u.startsWith('/instance/connect/') && k < f.chamadas.findIndex(x => x.startsWith('/instance/connect/')) + 1);
  assert.equal(abriu.length, 1);
  assert.ok(conexoes(f.chamadas) <= 2);
  f.fechar();
});
