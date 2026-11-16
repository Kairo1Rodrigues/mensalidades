// Teste de ponta a ponta: sobe o servidor de verdade com uma Evolution API falsa,
// simula um responsável mandando o comprovante no WhatsApp e confere a baixa.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PORTA = 3917, PORTA_EVO = 3918, SEGREDO = 'segredo-de-teste-1234567890';
const BASE = `http://127.0.0.1:${PORTA}`;
const enviadas = [];
let srv, evo, dir, cookie = '';

before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mens-'));
  evo = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      if (req.url.startsWith('/message/sendText/')) enviadas.push(JSON.parse(b));
      const corpo = req.url.startsWith('/instance/connectionState') ? { instance: { state: 'open' } } : { ok: true };
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(corpo));
    });
  }).listen(PORTA_EVO);
  srv = spawn(process.execPath, ['src/server.js'], {
    env: { ...process.env, PORT: PORTA, DATA_DIR: dir, SENHA_PAINEL: 'senha-forte-123', WEBHOOK_SECRET: SEGREDO, COOKIE_SECURE: '0',
      EVOLUTION_URL: `http://127.0.0.1:${PORTA_EVO}`, EVOLUTION_API_KEY: 'x', APP_URL_INTERNA: BASE },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(ok => srv.stdout.on('data', d => String(d).includes('rodando') && ok()));
});
after(async () => { srv?.kill(); evo?.close(); await rm(dir, { recursive: true, force: true }); });

async function api(metodo, url, corpo) {
  const r = await fetch(BASE + url, { method: metodo, headers: { 'content-type': 'application/json', cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, json: await r.json().catch(() => null) };
}

test('sem login não entra', async () => {
  assert.equal((await api('GET', '/api/estado')).status, 401);
  assert.equal((await api('POST', '/api/login', { senha: 'errada' })).status, 401);
});

test('fluxo completo: cadastro → comprovante pelo WhatsApp → baixa', async () => {
  assert.equal((await api('POST', '/api/login', { senha: 'senha-forte-123' })).status, 200);
  const imp = await api('POST', '/api/alunos', { alunos: [
    { nome: 'Lara Moreira', responsavel: 'Eduardo Souza Moreira', telefone: '(11) 97857-6408', turma: '2º ano', valor: '550' },
    { nome: 'Heitor Almeida', responsavel: 'Priscila Oliveira Almeida', telefone: '(11) 94288-4096', turma: '1º ano', valor: '480' },
  ] });
  assert.equal(imp.json.quantos, 2);

  // webhook com segredo errado é ignorado
  assert.equal((await fetch(`${BASE}/webhook/evolution/errado`, { method: 'POST', body: '{}' })).status, 404);

  const img = await readFile('test/fixtures/comprovante-exemplo.png');
  const webhook = {
    event: 'messages.upsert', instance: 'escola',
    data: {
      key: { remoteJid: '5511978576408@s.whatsapp.net', fromMe: false, id: 'MSG1' }, pushName: 'Eduardo',
      message: { imageMessage: { mimetype: 'image/png', caption: 'mensalidade da Lara' }, base64: img.toString('base64') },
      messageType: 'imageMessage',
    },
  };
  const post = () => fetch(`${BASE}/webhook/evolution/${SEGREDO}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(webhook) });
  assert.equal((await post()).status, 200);
  await post(); // a Evolution às vezes repete o webhook: não pode duplicar

  let c;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    const comps = (await api('GET', '/api/estado')).json.comprovantes;
    if (comps.length && comps[0].status === 'pendente') { c = comps[0]; assert.equal(comps.length, 1); break; }
  }
  assert.ok(c, 'o comprovante deveria ter sido lido');
  assert.equal(c.valor, 550);
  assert.equal(c.pagador, 'Eduardo Souza Moreira');
  assert.equal(c.telefone, '5511978576408');
  const est = (await api('GET', '/api/estado')).json;
  const lara = est.alunos.find(a => a.nome === 'Lara Moreira');
  assert.equal(c.sugestao.alunoId, lara.id);
  assert.equal(c.sugestao.confianca, 'alta');
  assert.deepEqual(c.sugestao.meses, [est.mesAtual]);

  // resposta automática de "recebido"
  assert.ok(enviadas.some(m => m.number === '5511978576408' && /Recebemos/.test(m.text)));

  const conf = await api('POST', `/api/comprovantes/${c.id}/confirmar`, { alunoId: lara.id, meses: c.sugestao.meses });
  assert.equal(conf.status, 200);
  const depois = (await api('GET', '/api/estado')).json;
  assert.ok(depois.pagamentos.some(p => p.aluno_id === lara.id && p.competencia === est.mesAtual && p.valor === 550 && p.comprovante_id === c.id));
  await new Promise(r => setTimeout(r, 200));
  assert.ok(enviadas.some(m => /confirmado/.test(m.text) && /Lara/.test(m.text)));

  // não deixa dar baixa duas vezes no mesmo mês
  assert.equal((await api('POST', '/api/pagamentos', { alunoId: lara.id, competencia: est.mesAtual, valor: 550 })).status, 409);

  // desfazer volta o comprovante para conferência
  await api('POST', `/api/comprovantes/${c.id}/reabrir`);
  const reaberto = (await api('GET', '/api/estado')).json;
  assert.equal(reaberto.comprovantes[0].status, 'pendente');
  assert.ok(!reaberto.pagamentos.some(p => p.aluno_id === lara.id));

  // planilha
  const csv = await (await fetch(`${BASE}/api/planilha.csv`, { headers: { cookie } })).text();
  assert.match(csv, /Lara Moreira/);
});
