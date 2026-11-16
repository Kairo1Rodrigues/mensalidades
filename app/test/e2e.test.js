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

// mensagens que a Evolution "guardou" durante a semana (para a varredura)
const guardadas = [];
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'mens-'));
  const img = (await readFile('test/fixtures/comprovante-exemplo.png')).toString('base64');
  evo = http.createServer((req, res) => {
    let b = ''; req.on('data', c => (b += c)); req.on('end', () => {
      if (req.url.startsWith('/message/sendText/')) enviadas.push(JSON.parse(b));
      let corpo = { ok: true };
      if (req.url.startsWith('/instance/connectionState')) corpo = { instance: { state: 'open' } };
      if (req.url.startsWith('/chat/findMessages/')) corpo = { messages: { total: guardadas.length, pages: 1, currentPage: 1, records: guardadas } };
      if (req.url.startsWith('/chat/getBase64FromMediaMessage/')) corpo = { base64: img, mimetype: 'image/png' };
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
  // provisão de mensalidades até o fim do ano que vem (o teste não depende da data de hoje)
  const { mesAtual } = (await api('GET', '/api/estado')).json;
  const fimProv = `${Number(mesAtual.slice(0, 4)) + 1}-12`;
  assert.equal((await api('PUT', '/api/config', { provisao_inicio: '2026-01', provisao_fim: fimProv })).status, 200);
  const imp = await api('POST', '/api/alunos', { alunos: [
    // Lara começa a ser cobrada neste mês: a sugestão do comprovante deve ser o mês atual
    { nome: 'Lara Moreira', responsavel: 'Eduardo Souza Moreira', telefone: '(11) 97857-6408', turma: '2º ano', valor: '550', inicio_cobranca: mesAtual },
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
  assert.match(csv, /Em atraso/);
});

test('mensalidades provisionadas: cadastro, reajuste, inativação e período', async () => {
  const proxMes = k => { let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}`; };
  const faixa = (a, b) => { const o = []; for (let k = a; k <= b; k = proxMes(k)) o.push(k); return o; };
  const est0 = (await api('GET', '/api/estado')).json;
  const { mesAtual } = est0, { provisao_inicio: ini, provisao_fim: fim } = est0.config;

  await api('POST', '/api/alunos', { nome: 'Teo Ramos', responsavel: 'Rita Ramos', telefone: '11 91111-2222', turma: '3º ano', valor: '500' });
  let est = (await api('GET', '/api/estado')).json;
  const teo = est.alunos.find(a => a.nome === 'Teo Ramos');
  const titulos = () => est.mensalidades.filter(t => t.aluno_id === teo.id).sort((x, y) => x.competencia.localeCompare(y.competencia));
  assert.deepEqual(titulos().map(t => t.competencia), faixa(ini, fim), 'um título por mês do período');
  assert.ok(titulos().every(t => t.valor === 500));

  // paga um mês antigo, depois reajusta: só os em aberto do mês atual em diante mudam
  assert.equal((await api('POST', '/api/pagamentos', { alunoId: teo.id, competencia: ini, valor: 500, data: `${ini}-05` })).status, 201);
  await api('PUT', `/api/alunos/${teo.id}`, { ...teo, valor: '600' });
  est = (await api('GET', '/api/estado')).json;
  for (const t of titulos()) assert.equal(t.valor, t.competencia >= mesAtual ? 600 : 500, t.competencia);

  // cobrar a partir de um mês depois: títulos em aberto antes dele saem, o pago fica
  const depois = proxMes(ini);
  await api('PUT', `/api/alunos/${teo.id}`, { ...teo, valor: '600', inicio_cobranca: proxMes(depois) });
  est = (await api('GET', '/api/estado')).json;
  assert.deepEqual(titulos().slice(0, 2).map(t => t.competencia), [ini, proxMes(depois)]);

  // inativo: some o futuro, fica o passado
  await api('PUT', `/api/alunos/${teo.id}`, { ...teo, valor: '600', inicio_cobranca: proxMes(depois), ativo: false });
  est = (await api('GET', '/api/estado')).json;
  assert.ok(titulos().every(t => t.competencia <= mesAtual));

  // período inválido é recusado
  assert.equal((await api('PUT', '/api/config', { provisao_inicio: '2027-12', provisao_fim: '2026-01' })).status, 400);
});

test('varredura dos últimos 7 dias importa só o que falta, sem responder', async () => {
  const ts = Math.floor(Date.now() / 1000) - 3 * 86400; // chegou há 3 dias, com o computador desligado
  guardadas.push(
    { key: { id: 'SEMANA1', remoteJid: '5511942884096@s.whatsapp.net', fromMe: false }, pushName: 'Priscila', messageType: 'imageMessage', messageTimestamp: ts, message: { imageMessage: { mimetype: 'image/png', caption: 'mensalidade Heitor' } } },
    { key: { id: 'SEMANA2', remoteJid: '5511942884096@s.whatsapp.net', fromMe: false }, pushName: 'Priscila', messageType: 'conversation', messageTimestamp: ts, message: { conversation: 'bom dia' } },
    { key: { id: 'SEMANA3', remoteJid: '5511900000000@s.whatsapp.net', fromMe: true }, messageType: 'imageMessage', messageTimestamp: ts, message: { imageMessage: { mimetype: 'image/png' } } },
    { key: { id: 'MSG1', remoteJid: '5511978576408@s.whatsapp.net', fromMe: false }, messageType: 'imageMessage', messageTimestamp: ts, message: { imageMessage: { mimetype: 'image/png' } } }, // já veio pelo webhook
  );
  const antes = enviadas.length;
  const r1 = await api('POST', '/api/whatsapp/varrer', { dias: 7 });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.encontradas, 2);
  assert.equal(r1.json.novas, 1);
  const est = (await api('GET', '/api/estado')).json;
  const novo = est.comprovantes.find(c => c.remetente === 'Priscila');
  assert.ok(novo, 'comprovante da semana importado');
  assert.ok(Math.abs(novo.recebidoEm - ts * 1000) < 1000, 'guarda a hora em que chegou no WhatsApp');
  assert.equal(enviadas.length, antes, 'não responde mensagens antigas');
  assert.equal(JSON.parse(est.config.ultima_varredura).novas, 1);
  // segunda busca não duplica
  assert.equal((await api('POST', '/api/whatsapp/varrer', { dias: 7 })).json.novas, 0);
  assert.equal((await api('POST', '/api/whatsapp/varrer', { dias: 99 })).status, 400);
});

test('CRM: anotações, promessa e cobrança registrada', async () => {
  const est = (await api('GET', '/api/estado')).json;
  const heitor = est.alunos.find(a => a.nome === 'Heitor Almeida');
  assert.equal((await api('POST', '/api/contatos', { alunoId: heitor.id, tipo: 'nota', texto: '' })).status, 400);
  assert.equal((await api('POST', '/api/contatos', { alunoId: heitor.id, tipo: 'nota', texto: 'Vai pagar sexta', promessa: '2026-12-04' })).status, 201);
  assert.equal((await api('POST', '/api/whatsapp/enviar', { telefone: heitor.telefone, texto: 'Olá', alunoId: heitor.id })).status, 200);
  const cs = (await api('GET', '/api/estado')).json.contatos.filter(c => c.aluno_id === heitor.id);
  assert.deepEqual(cs.map(c => c.tipo).sort(), ['cobranca', 'nota']);
  assert.equal(cs.find(c => c.tipo === 'nota').promessa, '2026-12-04');
  assert.equal((await api('DELETE', `/api/contatos/${cs[0].id}`)).status, 200);
});
