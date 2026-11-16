// Servidor do Mensalidades em Dia: painel web + recebimento dos comprovantes do WhatsApp.
// Sem dependências externas: só o Node.js (>= 22.13), o Tesseract e o poppler-utils.
import http from 'node:http';
import { writeFile, mkdir, stat, unlink, readdir } from 'node:fs/promises';
import { backup } from 'node:sqlite';
import { createReadStream } from 'node:fs';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { abrirBanco, lerConfig, salvarConfig } from './db.js';
import { extrairTexto } from './ocr.js';
import { parseComprovante } from './parse.js';
import { sugerirAluno } from './match.js';
import { criarEvolution, numeroDoRemetente, destinoResposta, midiaDaMensagem } from './evolution.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PUBLICO = path.join(AQUI, '..', 'public');
const env = process.env;
const CFG = {
  porta: Number(env.PORT || 3000),
  dados: env.DATA_DIR || path.join(AQUI, '..', 'dados'),
  senha: env.SENHA_PAINEL || '',
  segredoWebhook: env.WEBHOOK_SECRET || '',
  cookieSeguro: env.COOKIE_SECURE !== '0',
  evolution: {
    url: env.EVOLUTION_URL || '',
    apiKey: env.EVOLUTION_API_KEY || '',
    instancia: env.EVOLUTION_INSTANCIA || 'escola',
    webhookUrl: `${env.APP_URL_INTERNA || 'http://app:3000'}/webhook/evolution/${env.WEBHOOK_SECRET || ''}`,
  },
};
if (!CFG.senha || CFG.senha.length < 8) { console.error('Defina SENHA_PAINEL com pelo menos 8 caracteres no arquivo .env'); process.exit(1); }
if (CFG.evolution.url && CFG.segredoWebhook.length < 16) { console.error('Defina WEBHOOK_SECRET com pelo menos 16 caracteres no arquivo .env'); process.exit(1); }

const db = abrirBanco(CFG.dados);
const ARQUIVOS = path.join(CFG.dados, 'comprovantes');
await mkdir(ARQUIVOS, { recursive: true });
const wa = criarEvolution(CFG.evolution);

/* ---------------- datas e competências ---------------- */
const pad = n => String(n).padStart(2, '0');
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const mesAtual = () => hojeISO().slice(0, 7);
const proximoMes = k => { let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${pad(m)}`; };
const NOMES_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = k => `${NOMES_MES[+k.slice(5) - 1]}/${k.slice(0, 4)}`;
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function faixa(inicio, fim) {
  const out = []; let k = inicio;
  while (k <= fim && out.length < 120) { out.push(k); k = proximoMes(k); }
  return out;
}

// meses do controle: do início ao fim da provisão (e até o mês seguinte ao atual, se a provisão já acabou)
function competencias() {
  const c = lerConfig(db);
  const fim = c.provisao_fim > proximoMes(mesAtual()) ? c.provisao_fim : proximoMes(mesAtual());
  return faixa(c.provisao_inicio, fim);
}

/* ---------------- mensalidades provisionadas ---------------- */
// Gera um título por mês (provisao_inicio..provisao_fim) para cada aluno ativo, a partir do
// mês de início de cobrança dele, com o valor da mensalidade. Títulos em aberto fora da faixa
// do aluno são removidos; títulos pagos nunca são apagados.
const SEM_PAGAMENTO = 'NOT EXISTS (SELECT 1 FROM pagamentos p WHERE p.aluno_id = mensalidades.aluno_id AND p.competencia = mensalidades.competencia)';
function provisionar(alunoId = null) {
  const c = lerConfig(db);
  const alunos = alunoId == null ? db.prepare('SELECT * FROM alunos').all() : [db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId)].filter(Boolean);
  const ins = db.prepare('INSERT INTO mensalidades (aluno_id, competencia, valor) VALUES (?, ?, ?) ON CONFLICT(aluno_id, competencia) DO NOTHING');
  const limpar = db.prepare(`DELETE FROM mensalidades WHERE aluno_id = ? AND (competencia < ? OR competencia > ?) AND ${SEM_PAGAMENTO}`);
  const futuras = db.prepare(`DELETE FROM mensalidades WHERE aluno_id = ? AND competencia > ? AND ${SEM_PAGAMENTO}`);
  for (const a of alunos) {
    const inicio = a.inicio_cobranca > c.provisao_inicio ? a.inicio_cobranca : c.provisao_inicio;
    limpar.run(a.id, inicio, c.provisao_fim);
    if (!a.ativo) { futuras.run(a.id, mesAtual()); continue; } // aluno saiu: não cobra os meses seguintes
    for (const m of faixa(inicio, c.provisao_fim)) ins.run(a.id, m, a.valor);
  }
}
const valorTitulo = (alunoId, m) => db.prepare('SELECT valor FROM mensalidades WHERE aluno_id = ? AND competencia = ?').get(alunoId, m)?.valor;
// pagamento num mês sem título (ex.: fora da provisão) cria o título, para o histórico ficar completo
const garantirTitulo = (alunoId, m, valor) => db.prepare('INSERT INTO mensalidades (aluno_id, competencia, valor) VALUES (?, ?, ?) ON CONFLICT(aluno_id, competencia) DO NOTHING').run(alunoId, m, valor);

provisionar();

function mesesEmAbertoDe(alunoId) {
  return db.prepare(`SELECT competencia FROM mensalidades WHERE aluno_id = ? AND competencia <= ? AND ${SEM_PAGAMENTO} ORDER BY competencia`)
    .all(alunoId, mesAtual()).map(r => r.competencia);
}

/* ---------------- avisos em tempo real (SSE) ---------------- */
const clientes = new Set();
function avisar(tipo, dados = {}) {
  const msg = `event: ${tipo}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const res of clientes) res.write(msg);
}
setInterval(() => { for (const res of clientes) res.write(': ping\n\n'); }, 25_000).unref();

/* ---------------- processamento dos comprovantes ---------------- */
let fila = Promise.resolve();
const enfileirar = fn => (fila = fila.then(fn).catch(e => console.error('[processar]', e)));

async function processar(id) {
  const c = db.prepare('SELECT * FROM comprovantes WHERE id = ?').get(id);
  if (!c) return;
  let texto = '';
  try { texto = await extrairTexto(path.join(ARQUIVOS, c.arquivo), c.mime); }
  catch (e) { console.error('[ocr]', e.message); }
  const p = parseComprovante(texto);
  const alunos = db.prepare('SELECT * FROM alunos WHERE ativo = 1').all();
  const s = sugerirAluno({ telefone: c.telefone, valor: p.valor, pagador: p.pagador }, alunos, mesesEmAbertoDe);
  db.prepare(`UPDATE comprovantes SET status = 'pendente', texto = ?, valor = ?, data_pag = ?, hora_pag = ?, pagador = ?, banco = ?,
      id_transacao = ?, parece_comprovante = ?, sugestao_aluno_id = ?, sugestao_meses = ?, confianca = ?, motivo = ? WHERE id = ?`)
    .run(texto.slice(0, 20000), p.valor, p.data, p.hora, p.pagador, p.banco, p.idTransacao, p.pareceComprovante ? 1 : 0,
      s.alunoId, JSON.stringify(s.meses), s.confianca, s.motivo, id);
  avisar('comprovante', { id, novo: false });
}

const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' };

async function registrarComprovante({ base64, mime, origem, msgId = null, telefone = '', remetente = '', responder = '', legenda = '', recebidoEm = Date.now() }) {
  const buf = Buffer.from(String(base64).replace(/^data:[^,]+,/, ''), 'base64');
  if (!buf.length) throw new Error('arquivo vazio');
  if (buf.length > 12 * 1024 * 1024) throw new Error('arquivo maior que 12 MB');
  const nome = `${Date.now()}-${randomBytes(4).toString('hex')}${EXT[mime] || '.jpg'}`;
  await writeFile(path.join(ARQUIVOS, nome), buf);
  const r = db.prepare(`INSERT INTO comprovantes (recebido_em, origem, msg_id, telefone, remetente, responder, legenda, arquivo, mime, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'lendo') ON CONFLICT(msg_id) DO NOTHING`).run(recebidoEm, origem, msgId, telefone, remetente, responder, legenda, nome, mime);
  if (!r.changes) { await unlink(path.join(ARQUIVOS, nome)).catch(() => {}); return null; } // mesma mensagem chegou duas vezes
  const id = Number(r.lastInsertRowid);
  avisar('comprovante', { id, novo: true, remetente });
  enfileirar(() => processar(id));
  return id;
}

/* ---------------- webhook da Evolution API ---------------- */
// Uma mensagem do WhatsApp (do webhook ou da varredura): se for imagem/PDF de um contato, vira comprovante.
// Devolve o id do comprovante novo, ou null se não era comprovante ou já estava no sistema.
async function importarMensagem(data, { responderAuto }) {
  const jid = data?.key?.remoteJid || '';
  if (!data || data.key?.fromMe || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter')) return null;
  const midia = midiaDaMensagem(data);
  if (!midia) return null;
  const msgId = data.key?.id;
  if (msgId && db.prepare('SELECT 1 FROM comprovantes WHERE msg_id = ?').get(msgId)) return null; // já recebido
  let base64 = data.message?.base64 || data.base64;
  let mime = midia.mime;
  if (!base64) { const m = await wa.midia(data); base64 = m.base64; mime = m.mime || mime; }
  if (!base64) { console.error('[whatsapp] mensagem sem mídia', msgId); return null; }
  mime = String(mime).split(';')[0];
  const responder = destinoResposta(data);
  const ts = Number(data.messageTimestamp);
  const recebidoEm = ts > 1e9 ? (ts < 1e12 ? ts * 1000 : ts) : Date.now();
  const novo = await registrarComprovante({ base64, mime, origem: 'whatsapp', msgId, telefone: numeroDoRemetente(data), remetente: data.pushName || '', responder, legenda: midia.legenda, recebidoEm });
  const conf = lerConfig(db);
  if (novo && responderAuto && conf.resposta_recebido === '1' && responder) wa.enviarTexto(responder, conf.texto_recebido).catch(e => console.error('[resposta]', e.message));
  return novo;
}

async function receberWebhook(corpo) {
  const evento = String(corpo?.event || '').toLowerCase().replace(/_/g, '.');
  if (evento === 'connection.update') {
    avisar('whatsapp', { estado: corpo?.data?.state });
    // acabou de conectar (ex.: computador ligado na segunda): procura o que chegou na semana
    if (corpo?.data?.state === 'open') setTimeout(() => varrerComprovantes(7).catch(e => console.error('[varredura]', e.message)), 30_000).unref();
    return;
  }
  if (evento !== 'messages.upsert') return;
  const lista = Array.isArray(corpo.data) ? corpo.data : [corpo.data];
  // mensagens antigas (entregues quando o computador volta a ligar) não recebem resposta automática
  for (const data of lista) {
    const ts = Number(data?.messageTimestamp) || 0;
    const recente = !ts || Date.now() - (ts < 1e12 ? ts * 1000 : ts) < 6 * 3600_000;
    try { await importarMensagem(data, { responderAuto: recente }); }
    catch (e) { console.error('[webhook]', data?.key?.id, e.message); } // a varredura tenta de novo depois
  }
}

/* ---------------- varredura: comprovantes dos últimos dias ---------------- */
// A Evolution guarda as mensagens que recebe. A varredura relê esse histórico e importa as imagens
// e PDFs que ainda não viraram comprovante (ex.: chegaram enquanto o painel estava fora do ar).
let varrendo = null;
function varrerComprovantes(dias = 7) {
  if (varrendo) return varrendo;
  varrendo = (async () => {
    const res = { em: Date.now(), dias, encontradas: 0, novas: 0, erros: 0 };
    try {
      if (!wa.configurada) throw Object.assign(new Error('A Evolution API não está configurada.'), { status: 400 });
      if ((await wa.estado()) !== 'open') throw Object.assign(new Error('O WhatsApp da escola não está conectado. Conecte na aba WhatsApp e tente de novo.'), { status: 409 });
      const desde = new Date(Date.now() - dias * 864e5), ate = new Date(Date.now() + 60_000);
      for (let pagina = 1, total = 1; pagina <= total && pagina <= 50; pagina++) {
        const { registros, paginas } = await wa.buscarMensagens({ desde, ate, pagina });
        total = paginas;
        for (const r of registros) {
          if (!midiaDaMensagem(r) || r.key?.fromMe) continue;
          res.encontradas++;
          try { if (await importarMensagem(r, { responderAuto: false })) res.novas++; }
          catch (e) { res.erros++; console.error('[varredura]', r.key?.id, e.message); }
        }
      }
      salvarConfig(db, { ultima_varredura: JSON.stringify(res) });
      avisar('dados');
      return res;
    } finally { varrendo = null; }
  })();
  return varrendo;
}

/* ---------------- login ---------------- */
const tentativas = new Map();
function senhaConfere(s) {
  const a = createHash('sha256').update(String(s)).digest(), b = createHash('sha256').update(CFG.senha).digest();
  return timingSafeEqual(a, b);
}
function lerCookie(req, nome) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + nome + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
function logado(req) {
  const t = lerCookie(req, 'sessao');
  if (!t) return false;
  const s = db.prepare('SELECT expira FROM sessoes WHERE token = ?').get(t);
  return !!s && s.expira > Date.now();
}
const cookie = (valor, maxAge) => `sessao=${valor}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${CFG.cookieSeguro ? '; Secure' : ''}`;

/* ---------------- dados para o painel ---------------- */
function linhaComprovante(c) {
  return {
    id: c.id, recebidoEm: c.recebido_em, origem: c.origem, telefone: c.telefone, remetente: c.remetente, legenda: c.legenda,
    mime: c.mime, status: c.status, valor: c.valor, data: c.data_pag, hora: c.hora_pag, pagador: c.pagador, banco: c.banco,
    idTransacao: c.id_transacao, pareceComprovante: c.parece_comprovante === null ? null : !!c.parece_comprovante,
    sugestao: { alunoId: c.sugestao_aluno_id, meses: JSON.parse(c.sugestao_meses || '[]'), confianca: c.confianca, motivo: c.motivo },
    alunoId: c.aluno_id, competencias: JSON.parse(c.competencias || '[]'), conferidoEm: c.conferido_em,
  };
}
function estado() {
  const conf = lerConfig(db);
  return {
    hoje: hojeISO(), mesAtual: mesAtual(), competencias: competencias(),
    config: conf,
    alunos: db.prepare('SELECT * FROM alunos ORDER BY nome COLLATE NOCASE').all(),
    pagamentos: db.prepare('SELECT * FROM pagamentos').all(),
    mensalidades: db.prepare('SELECT aluno_id, competencia, valor FROM mensalidades').all(),
    contatos: db.prepare('SELECT * FROM contatos ORDER BY quando DESC').all(),
    comprovantes: db.prepare(`SELECT * FROM comprovantes WHERE status IN ('lendo','pendente') OR recebido_em > ? ORDER BY recebido_em DESC LIMIT 400`)
      .all(Date.now() - 120 * 864e5).map(linhaComprovante),
    whatsappConfigurado: wa.configurada,
  };
}
function preencher(modelo, vars) { return String(modelo).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)); }

/* ---------------- HTTP ---------------- */
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf' };
const SEGURANCA = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
};
function json(res, status, dados, extra = {}) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SEGURANCA, ...extra }); res.end(JSON.stringify(dados)); }
const erro = (res, status, mensagem) => json(res, status, { erro: mensagem });

async function corpoJson(req, limite = 16 * 1024 * 1024) {
  const partes = []; let tam = 0;
  for await (const p of req) { tam += p.length; if (tam > limite) throw Object.assign(new Error('Arquivo grande demais.'), { status: 413 }); partes.push(p); }
  if (!tam) return {};
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); } catch { throw Object.assign(new Error('JSON inválido.'), { status: 400 }); }
}

async function servirArquivo(res, arquivo, cache = 'no-cache') {
  try {
    const st = await stat(arquivo);
    res.writeHead(200, { 'content-type': TIPOS[path.extname(arquivo)] || 'application/octet-stream', 'content-length': st.size, 'cache-control': cache, ...SEGURANCA });
    createReadStream(arquivo).pipe(res);
  } catch { erro(res, 404, 'Não encontrado.'); }
}

const rotas = [];
const rota = (metodo, padrao, fn, { publica = false } = {}) => rotas.push({ metodo, padrao, fn, publica });

rota('POST', /^\/webhook\/evolution\/([^/]+)$/, async (req, res, [segredo]) => {
  if (!CFG.segredoWebhook || segredo.length !== CFG.segredoWebhook.length || !timingSafeEqual(Buffer.from(segredo), Buffer.from(CFG.segredoWebhook))) return erro(res, 404, 'Não encontrado.');
  const corpo = await corpoJson(req, 40 * 1024 * 1024);
  json(res, 200, { ok: true }); // responde logo; processa depois
  receberWebhook(corpo).catch(e => console.error('[webhook]', e));
}, { publica: true });

rota('POST', /^\/api\/login$/, async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const t = tentativas.get(ip) || { n: 0, ate: 0 };
  if (t.ate > Date.now()) return erro(res, 429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
  const { senha } = await corpoJson(req, 10_000);
  if (!senhaConfere(senha || '')) {
    t.n++; if (t.n >= 5) { t.ate = Date.now() + 5 * 60_000; t.n = 0; } tentativas.set(ip, t);
    return erro(res, 401, 'Senha incorreta.');
  }
  tentativas.delete(ip);
  const token = randomBytes(32).toString('hex');
  const dias = 60;
  db.prepare('DELETE FROM sessoes WHERE expira < ?').run(Date.now());
  db.prepare('INSERT INTO sessoes (token, expira) VALUES (?, ?)').run(token, Date.now() + dias * 864e5);
  json(res, 200, { ok: true }, { 'set-cookie': cookie(token, dias * 86400) });
}, { publica: true });

rota('POST', /^\/api\/sair$/, async (req, res) => {
  const t = lerCookie(req, 'sessao'); if (t) db.prepare('DELETE FROM sessoes WHERE token = ?').run(t);
  json(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
});

rota('GET', /^\/api\/estado$/, async (req, res) => json(res, 200, estado()));

rota('GET', /^\/api\/eventos$/, async (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  clientes.add(res);
  req.on('close', () => clientes.delete(res));
});

/* comprovantes */
rota('GET', /^\/api\/comprovantes\/(\d+)\/arquivo$/, async (req, res, [id]) => {
  const c = db.prepare('SELECT arquivo FROM comprovantes WHERE id = ?').get(id);
  if (!c?.arquivo) return erro(res, 404, 'Comprovante não encontrado.');
  servirArquivo(res, path.join(ARQUIVOS, path.basename(c.arquivo)), 'private, max-age=86400');
});
rota('GET', /^\/api\/comprovantes\/(\d+)\/texto$/, async (req, res, [id]) => {
  const c = db.prepare('SELECT texto FROM comprovantes WHERE id = ?').get(id);
  c ? json(res, 200, { texto: c.texto || '' }) : erro(res, 404, 'Comprovante não encontrado.');
});
rota('POST', /^\/api\/comprovantes$/, async (req, res) => {
  const { base64, mime } = await corpoJson(req);
  if (!EXT[mime]) return erro(res, 400, 'Envie uma imagem (JPG, PNG, WEBP) ou um PDF.');
  const id = await registrarComprovante({ base64, mime, origem: 'upload', remetente: 'Enviado pelo painel' });
  json(res, 201, { id });
});
rota('POST', /^\/api\/comprovantes\/(\d+)\/confirmar$/, async (req, res, [id]) => {
  const { alunoId, meses = [], valores = {} } = await corpoJson(req, 100_000);
  const c = db.prepare('SELECT * FROM comprovantes WHERE id = ?').get(id);
  const a = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId);
  if (!c || !a) return erro(res, 404, 'Comprovante ou aluno não encontrado.');
  if (c.status === 'aprovado') return erro(res, 409, 'Este comprovante já foi confirmado.');
  const validos = competencias();
  if (!meses.length || meses.some(m => !validos.includes(m))) return erro(res, 400, 'Escolha pelo menos um mês válido.');
  const ja = meses.filter(m => db.prepare('SELECT 1 FROM pagamentos WHERE aluno_id = ? AND competencia = ?').get(a.id, m));
  if (ja.length) return erro(res, 409, `${a.nome} já tem ${ja.map(nomeMes).join(', ')} pago.`);
  const data = c.data_pag || hojeISO();
  const padrao = m => (meses.length === 1 && c.valor ? c.valor : valorTitulo(a.id, m) ?? a.valor);
  db.exec('BEGIN');
  try {
    const ins = db.prepare('INSERT INTO pagamentos (aluno_id, competencia, valor, data, via, comprovante_id, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const m of meses) { garantirTitulo(a.id, m, valorTitulo(a.id, m) ?? a.valor); ins.run(a.id, m, Number(valores[m]) || padrao(m), data, 'Pix', c.id, Date.now()); }
    db.prepare(`UPDATE comprovantes SET status = 'aprovado', aluno_id = ?, competencias = ?, conferido_em = ? WHERE id = ?`).run(a.id, JSON.stringify(meses.sort()), Date.now(), c.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  const conf = lerConfig(db);
  if (c.origem === 'whatsapp' && c.responder && conf.resposta_confirmado === '1')
    wa.enviarTexto(c.responder, preencher(conf.texto_confirmado, { aluno: a.nome, meses: meses.map(nomeMes).join(', '), escola: conf.escola })).catch(e => console.error('[resposta]', e.message));
  avisar('dados'); json(res, 200, { ok: true });
});
rota('POST', /^\/api\/comprovantes\/(\d+)\/rejeitar$/, async (req, res, [id]) => {
  const r = db.prepare(`UPDATE comprovantes SET status = 'rejeitado', conferido_em = ? WHERE id = ? AND status IN ('pendente','lendo')`).run(Date.now(), id);
  if (!r.changes) return erro(res, 409, 'Este comprovante não está esperando conferência.');
  avisar('dados'); json(res, 200, { ok: true });
});
rota('POST', /^\/api\/comprovantes\/(\d+)\/reabrir$/, async (req, res, [id]) => {
  db.exec('BEGIN');
  db.prepare('DELETE FROM pagamentos WHERE comprovante_id = ?').run(id);
  db.prepare(`UPDATE comprovantes SET status = 'pendente', aluno_id = NULL, competencias = NULL, conferido_em = NULL WHERE id = ?`).run(id);
  db.exec('COMMIT');
  avisar('dados'); json(res, 200, { ok: true });
});
rota('POST', /^\/api\/comprovantes\/(\d+)\/reler$/, async (req, res, [id]) => {
  db.prepare(`UPDATE comprovantes SET status = 'lendo' WHERE id = ? AND status IN ('pendente','lendo')`).run(id);
  enfileirar(() => processar(Number(id))); avisar('dados'); json(res, 200, { ok: true });
});

/* alunos */
function dadosAluno(b) {
  const nome = String(b.nome || '').trim();
  if (!nome) throw Object.assign(new Error('Informe o nome do aluno.'), { status: 400 });
  const valor = Number(String(b.valor ?? '').replace(',', '.'));
  if (!(valor >= 0)) throw Object.assign(new Error('Informe o valor da mensalidade.'), { status: 400 });
  const inicio = String(b.inicio_cobranca || '').trim();
  if (inicio && !MES_RE.test(inicio)) throw Object.assign(new Error('Mês de início da cobrança inválido.'), { status: 400 });
  return [nome, String(b.responsavel || '').trim(), String(b.telefone || '').trim(), String(b.telefone2 || '').trim(), String(b.turma || '').trim(), valor, inicio];
}
rota('POST', /^\/api\/alunos$/, async (req, res) => {
  const b = await corpoJson(req, 200_000);
  const lista = Array.isArray(b.alunos) ? b.alunos : [b];
  db.exec('BEGIN');
  try {
    const ins = db.prepare('INSERT INTO alunos (nome, responsavel, telefone, telefone2, turma, valor, inicio_cobranca, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const a of lista) provisionar(Number(ins.run(...dadosAluno(a), Date.now()).lastInsertRowid));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  avisar('dados'); json(res, 201, { ok: true, quantos: lista.length });
});
rota('PUT', /^\/api\/alunos\/(\d+)$/, async (req, res, [id]) => {
  const b = await corpoJson(req, 100_000);
  const dados = dadosAluno(b);
  const antes = db.prepare('SELECT valor FROM alunos WHERE id = ?').get(id);
  if (!antes) return erro(res, 404, 'Aluno não encontrado.');
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE alunos SET nome = ?, responsavel = ?, telefone = ?, telefone2 = ?, turma = ?, valor = ?, inicio_cobranca = ?, ativo = ? WHERE id = ?')
      .run(...dados, b.ativo === false || b.ativo === 0 ? 0 : 1, id);
    // mensalidade mudou: vale para os títulos em aberto do mês atual em diante (os atrasados mantêm o valor)
    if (dados[5] !== antes.valor)
      db.prepare(`UPDATE mensalidades SET valor = ? WHERE aluno_id = ? AND competencia >= ? AND ${SEM_PAGAMENTO}`).run(dados[5], id, mesAtual());
    provisionar(Number(id));
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  avisar('dados'); json(res, 200, { ok: true });
});
rota('DELETE', /^\/api\/alunos\/(\d+)$/, async (req, res, [id]) => {
  db.prepare('DELETE FROM alunos WHERE id = ?').run(id);
  avisar('dados'); json(res, 200, { ok: true });
});

/* pagamentos manuais */
rota('POST', /^\/api\/pagamentos$/, async (req, res) => {
  const { alunoId, competencia, valor, data, via } = await corpoJson(req, 10_000);
  const a = db.prepare('SELECT * FROM alunos WHERE id = ?').get(alunoId);
  if (!a) return erro(res, 404, 'Aluno não encontrado.');
  if (!competencias().includes(competencia)) return erro(res, 400, 'Mês inválido.');
  if (db.prepare('SELECT 1 FROM pagamentos WHERE aluno_id = ? AND competencia = ?').get(a.id, competencia)) return erro(res, 409, `${nomeMes(competencia)} já está pago.`);
  const titulo = valorTitulo(a.id, competencia) ?? a.valor;
  garantirTitulo(a.id, competencia, titulo);
  db.prepare('INSERT INTO pagamentos (aluno_id, competencia, valor, data, via, criado_em) VALUES (?, ?, ?, ?, ?, ?)')
    .run(a.id, competencia, Number(valor) || titulo, /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : hojeISO(), String(via || 'Dinheiro').slice(0, 20), Date.now());
  avisar('dados'); json(res, 201, { ok: true });
});
rota('DELETE', /^\/api\/pagamentos\/(\d+)$/, async (req, res, [id]) => {
  const p = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(id);
  if (!p) return erro(res, 404, 'Pagamento não encontrado.');
  db.exec('BEGIN');
  db.prepare('DELETE FROM pagamentos WHERE id = ?').run(id);
  if (p.comprovante_id) {
    const c = db.prepare('SELECT competencias FROM comprovantes WHERE id = ?').get(p.comprovante_id);
    const resto = JSON.parse(c?.competencias || '[]').filter(m => m !== p.competencia);
    if (resto.length) db.prepare('UPDATE comprovantes SET competencias = ? WHERE id = ?').run(JSON.stringify(resto), p.comprovante_id);
    else db.prepare(`UPDATE comprovantes SET status = 'pendente', aluno_id = NULL, competencias = NULL WHERE id = ?`).run(p.comprovante_id);
  }
  db.exec('COMMIT');
  avisar('dados'); json(res, 200, { ok: true });
});

/* configurações */
rota('PUT', /^\/api\/config$/, async (req, res) => {
  const b = await corpoJson(req, 50_000);
  const atual = lerConfig(db);
  const ini = b.provisao_inicio ?? atual.provisao_inicio, fim = b.provisao_fim ?? atual.provisao_fim;
  if (!MES_RE.test(ini) || !MES_RE.test(fim)) return erro(res, 400, 'Informe o primeiro e o último mês das mensalidades.');
  if (fim < ini) return erro(res, 400, 'O último mês precisa ser depois do primeiro.');
  if (faixa(ini, fim).length > 60) return erro(res, 400, 'Gere no máximo 5 anos de mensalidades de uma vez.');
  db.exec('BEGIN');
  try { salvarConfig(db, b); if (ini !== atual.provisao_inicio || fim !== atual.provisao_fim) provisionar(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  avisar('dados'); json(res, 200, { ok: true });
});

/* WhatsApp */
rota('GET', /^\/api\/whatsapp$/, async (req, res) => {
  if (!wa.configurada) return json(res, 200, { estado: 'nao-configurado' });
  try { json(res, 200, { estado: await wa.estado() }); } catch (e) { json(res, 200, { estado: 'fora-do-ar', detalhe: e.message }); }
});
rota('POST', /^\/api\/whatsapp\/conectar$/, async (req, res) => {
  if (!wa.configurada) return erro(res, 400, 'A Evolution API não está configurada no .env.');
  try { json(res, 200, await wa.conectar()); } catch (e) { erro(res, 502, 'Não consegui falar com a Evolution API: ' + e.message); }
});
rota('POST', /^\/api\/whatsapp\/desconectar$/, async (req, res) => {
  try { await wa.desconectar(); json(res, 200, { ok: true }); } catch (e) { erro(res, 502, e.message); }
});
rota('POST', /^\/api\/whatsapp\/enviar$/, async (req, res) => {
  const { telefone, texto, alunoId } = await corpoJson(req, 20_000);
  let n = String(telefone || '').replace(/\D/g, ''); if (n.length <= 11) n = '55' + n;
  if (n.length < 12 || !String(texto || '').trim()) return erro(res, 400, 'Telefone ou mensagem inválidos.');
  try { await wa.enviarTexto(n, String(texto)); } catch (e) { return erro(res, 502, 'O WhatsApp não enviou: ' + e.message); }
  if (alunoId && db.prepare('SELECT 1 FROM alunos WHERE id = ?').get(alunoId)) {
    db.prepare('INSERT INTO contatos (aluno_id, quando, tipo, texto) VALUES (?, ?, ?, ?)').run(alunoId, Date.now(), 'cobranca', 'Cobrança enviada pelo WhatsApp da escola');
    avisar('dados');
  }
  json(res, 200, { ok: true });
});
rota('POST', /^\/api\/whatsapp\/varrer$/, async (req, res) => {
  const { dias = 7 } = await corpoJson(req, 1000);
  const d = Math.round(Number(dias));
  if (!(d >= 1 && d <= 30)) return erro(res, 400, 'Escolha de 1 a 30 dias.');
  json(res, 200, await varrerComprovantes(d));
});

/* CRM: contatos e anotações */
rota('POST', /^\/api\/contatos$/, async (req, res) => {
  const { alunoId, tipo, texto = '', promessa = null } = await corpoJson(req, 20_000);
  if (!db.prepare('SELECT 1 FROM alunos WHERE id = ?').get(alunoId)) return erro(res, 404, 'Aluno não encontrado.');
  if (!['cobranca', 'whatsapp', 'nota'].includes(tipo)) return erro(res, 400, 'Tipo de contato inválido.');
  if (promessa && !/^\d{4}-\d{2}-\d{2}$/.test(promessa)) return erro(res, 400, 'Data da promessa inválida.');
  if (tipo === 'nota' && !String(texto).trim() && !promessa) return erro(res, 400, 'Escreva a anotação.');
  const r = db.prepare('INSERT INTO contatos (aluno_id, quando, tipo, texto, promessa) VALUES (?, ?, ?, ?, ?)').run(alunoId, Date.now(), tipo, String(texto).trim().slice(0, 2000), promessa || null);
  avisar('dados'); json(res, 201, { id: Number(r.lastInsertRowid) });
});
rota('DELETE', /^\/api\/contatos\/(\d+)$/, async (req, res, [id]) => {
  db.prepare('DELETE FROM contatos WHERE id = ?').run(id);
  avisar('dados'); json(res, 200, { ok: true });
});

/* planilha */
rota('GET', /^\/api\/planilha\.csv$/, async (req, res) => {
  const comps = competencias();
  const pag = new Map(db.prepare('SELECT * FROM pagamentos').all().map(p => [`${p.aluno_id}|${p.competencia}`, p]));
  const tit = new Map(db.prepare('SELECT * FROM mensalidades').all().map(t => [`${t.aluno_id}|${t.competencia}`, t.valor]));
  const venc = Number(lerConfig(db).vencimento) || 10, hoje = hojeISO();
  const vencido = m => m < mesAtual() || (m === mesAtual() && Number(hoje.slice(8)) > venc);
  const linhas = [['Aluno', 'Responsável', 'Telefone', 'Turma', 'Mensalidade', ...comps.map(nomeMes), 'Pago', 'Em atraso', 'A vencer']];
  for (const a of db.prepare('SELECT * FROM alunos WHERE ativo = 1 ORDER BY nome COLLATE NOCASE').all()) {
    let pago = 0, atraso = 0, avencer = 0;
    const cel = comps.map(m => {
      const p = pag.get(`${a.id}|${m}`), v = tit.get(`${a.id}|${m}`);
      if (p) { pago += p.valor; return `pago ${p.data.split('-').reverse().join('/')} (${p.via})`; }
      if (v == null) return '';
      if (vencido(m)) { atraso += v; return `em atraso ${BRL.format(v)}`; }
      avencer += v; return `a vencer ${BRL.format(v)}`;
    });
    linhas.push([a.nome, a.responsavel, a.telefone, a.turma, BRL.format(a.valor), ...cel, BRL.format(pago), BRL.format(atraso), BRL.format(avencer)]);
  }
  const csv = '﻿' + linhas.map(l => l.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="mensalidades-${hojeISO()}.csv"`, ...SEGURANCA });
  res.end(csv);
});

rota('GET', /^\/saude$/, async (req, res) => json(res, 200, { ok: true }), { publica: true });

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    for (const r of rotas) {
      if (r.metodo !== req.method) continue;
      const m = url.pathname.match(r.padrao);
      if (!m) continue;
      if (!r.publica && !logado(req)) return erro(res, 401, 'Faça login de novo.');
      return await r.fn(req, res, m.slice(1));
    }
    if (req.method !== 'GET') return erro(res, 404, 'Não encontrado.');
    // páginas e arquivos estáticos
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (!logado(req)) { res.writeHead(302, { location: '/entrar' }); return res.end(); }
      return servirArquivo(res, path.join(PUBLICO, 'index.html'));
    }
    if (url.pathname === '/entrar') return servirArquivo(res, path.join(PUBLICO, 'entrar.html'));
    const arq = path.join(PUBLICO, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!arq.startsWith(PUBLICO) || arq.endsWith('.html')) return erro(res, 404, 'Não encontrado.');
    return servirArquivo(res, arq);
  } catch (e) {
    if (!res.headersSent) erro(res, e.status || 500, e.status ? e.message : 'Erro interno. Tente de novo.');
    if (!e.status) console.error(e);
  }
});

/* ---------------- backup diário (guarda 14 dias) ---------------- */
async function fazerBackup() {
  try {
    const pasta = path.join(CFG.dados, 'backups');
    await mkdir(pasta, { recursive: true });
    await backup(db, path.join(pasta, `escola-${hojeISO()}.db`));
    const antigos = (await readdir(pasta)).filter(f => /^escola-.*\.db$/.test(f)).sort().slice(0, -14);
    for (const f of antigos) await unlink(path.join(pasta, f));
  } catch (e) { console.error('[backup]', e.message); }
}
setTimeout(fazerBackup, 60_000).unref();
setInterval(fazerBackup, 24 * 3600_000).unref();

// comprovantes que ficaram "lendo" (servidor reiniciou no meio) voltam para a fila
for (const { id } of db.prepare(`SELECT id FROM comprovantes WHERE status = 'lendo'`).all()) enfileirar(() => processar(id));

// ao ligar (ex.: segunda-feira de manhã), procura os comprovantes da última semana
if (wa.configurada) setTimeout(() => varrerComprovantes(7).catch(e => console.error('[varredura]', e.message)), 90_000).unref();

servidor.listen(CFG.porta, () => console.log(`Mensalidades em Dia rodando na porta ${CFG.porta}`));
for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => { servidor.close(); db.close(); process.exit(0); });
