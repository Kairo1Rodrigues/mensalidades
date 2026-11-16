// Painel do Mensalidades em Dia.
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const lblMes = k => MES[+k.slice(5) - 1];
const lblMesLongo = k => MES_LONGO[+k.slice(5) - 1] + ' de ' + k.slice(0, 4);
const dataBR = iso => (iso ? iso.split('-').reverse().join('/') : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);

const S = { e: null, pag: new Map(), tit: new Map(), alunos: new Map(), mes: null, compF: 'conferir', alF: 'todos', busca: '', sel: {}, wa: null };

/* ---------- API ---------- */
async function api(metodo, url, corpo) {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'content-type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 401) { location.replace('/entrar'); throw new Error('sessão expirada'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || 'Algo deu errado. Tente de novo.');
  return j;
}
async function carregar() {
  const e = await api('GET', '/api/estado');
  S.e = e;
  S.alunos = new Map(e.alunos.map(a => [a.id, a]));
  S.pag = new Map(e.pagamentos.map(p => [`${p.aluno_id}|${p.competencia}`, p]));
  S.tit = new Map(e.mensalidades.map(t => [`${t.aluno_id}|${t.competencia}`, t.valor]));
  S.cont = new Map(); for (const c of e.contatos) { if (!S.cont.has(c.aluno_id)) S.cont.set(c.aluno_id, []); S.cont.get(c.aluno_id).push(c); }
  if (!S.mes || !e.competencias.includes(S.mes)) S.mes = e.mesAtual;
  renderAll();
}
let recarregando = null;
const recarregar = () => { clearTimeout(recarregando); recarregando = setTimeout(() => carregar().catch(() => {}), 150); };

/* ---------- regras ---------- */
const meses = () => S.e.competencias;
const ativos = () => S.e.alunos.filter(a => a.ativo);
// valor da mensalidade provisionada do mês (undefined = aluno não é cobrado nesse mês)
const valorMes = (a, m) => S.tit.get(`${a.id}|${m}`);
function statusMes(a, m) {
  if (S.pag.has(`${a.id}|${m}`)) return 'pago';
  if (valorMes(a, m) == null) return 'sem';
  const atual = S.e.mesAtual;
  if (m < atual) return 'atrasado';
  if (m === atual) return +S.e.hoje.slice(8) > (+S.e.config.vencimento || 10) ? 'atrasado' : 'avencer';
  return 'avencer';
}
const ST_LBL = { pago: 'Pago', atrasado: 'Em atraso', avencer: 'A vencer', futuro: 'Futuro', sem: 'Sem mensalidade' };
const emAberto = a => meses().filter(m => m <= S.e.mesAtual && ['atrasado', 'avencer'].includes(statusMes(a, m)));
const atrasados = a => meses().filter(m => statusMes(a, m) === 'atrasado');
const somaMeses = (a, ms) => ms.reduce((s, m) => s + (valorMes(a, m) ?? a.valor), 0);

/* ---------- topo e resumo ---------- */
function renderMonths() {
  const ms = meses().filter(m => m <= S.e.mesAtual).slice(-6);
  $('#months').innerHTML = ms.map(m => `<button aria-pressed="${m === S.mes}" data-m="${m}"><small>${m.slice(0, 4)}</small>${lblMes(m)}${m === S.e.mesAtual ? ' · atual' : ''}</button>`).join('');
}
$('#months').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { S.mes = b.dataset.m; renderAll(); } });

function renderKpis() {
  const al = ativos(), m = S.mes;
  const previsto = al.reduce((s, a) => s + (valorMes(a, m) ?? 0), 0);
  const recebido = al.reduce((s, a) => s + (S.pag.get(`${a.id}|${m}`)?.valor || 0), 0);
  const pagos = al.filter(a => statusMes(a, m) === 'pago').length;
  const abertos = al.filter(a => ['atrasado', 'avencer'].includes(statusMes(a, m)));
  const atraso = al.reduce((s, a) => s + somaMeses(a, atrasados(a)), 0);
  const devedores = al.filter(a => atrasados(a).length).length;
  const conferir = S.e.comprovantes.filter(c => c.status === 'pendente' || c.status === 'lendo').length;
  const pct = previsto ? Math.min(100, recebido / previsto * 100) : 0;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="label">Recebido em ${esc(lblMesLongo(m))}</div><div class="v num">${BRL.format(recebido)}</div>
      <div class="s num">de ${BRL.format(previsto)} previstos · ${pct.toFixed(0)}%</div>
      <div class="bar" role="img" aria-label="${pct.toFixed(0)}% recebido"><i style="width:${pct}%;background:var(--ok)"></i></div></div>
    <div class="kpi"><div class="label">Pagaram</div><div class="v num">${pagos}<span class="muted" style="font-size:16px"> / ${al.length}</span></div><div class="s">alunos neste mês</div></div>
    <div class="kpi"><div class="label">Em aberto</div><div class="v num">${abertos.length}</div><div class="s num">${BRL.format(abertos.reduce((s, a) => s + valorMes(a, m), 0))} a receber</div></div>
    <div class="kpi ${conferir ? 'alert' : ''}"><div class="label">A conferir</div><div class="v num">${conferir}</div><div class="s num">${conferir ? 'comprovantes esperando você' : 'nenhum comprovante novo'} · atraso total ${BRL.format(atraso)} (${devedores} alunos)</div></div>`;
  const cc = $('#cntComp'); cc.textContent = conferir; cc.classList.toggle('hot', conferir > 0);
  $('#cntAlunos').textContent = al.length;
  $('#escolaNome').textContent = S.e.config.escola;
  document.title = (conferir ? `(${conferir}) ` : '') + 'Mensalidades em Dia';
}

/* ---------- abas ---------- */
const TABS = ['comprovantes', 'alunos', 'financeiro', 'whatsapp', 'ajustes'];
function abrirAba(t) {
  if (!TABS.includes(t)) t = 'comprovantes';
  document.querySelectorAll('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === t));
  TABS.forEach(x => $('#p-' + x).hidden = x !== t);
  if (t === 'whatsapp') verWhatsapp();
  if (t === 'ajustes') preencherAjustes();
  if (t === 'financeiro') renderFin();
  history.replaceState(null, '', '#' + t);
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) abrirAba(b.dataset.tab); });

/* ---------- comprovantes ---------- */
function tempo(ms) {
  const d = new Date(ms), diff = (Date.now() - ms) / 60000;
  if (diff < 1) return 'agora'; if (diff < 60) return `há ${Math.round(diff)} min`;
  const hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return 'hoje ' + hh;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' ' + hh;
}
const fmtTel = t => { const d = String(t || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length >= 10 ? `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}` : t; };
function selDe(c) {
  if (!S.sel[c.id]) S.sel[c.id] = { alunoId: c.sugestao.alunoId || '', meses: new Set(c.sugestao.meses || []) };
  return S.sel[c.id];
}
const ordem = c => ({ lendo: 0, pendente: 0, aprovado: 1, rejeitado: 2 }[c.status] ?? 1);
function renderComps() {
  let list = S.e.comprovantes.slice().sort((a, b) => (ordem(a) - ordem(b)) || (b.recebidoEm - a.recebidoEm));
  if (S.compF === 'conferir') list = list.filter(c => c.status === 'pendente' || c.status === 'lendo');
  const box = $('#comps');
  if (!list.length) { box.innerHTML = `<div class="empty">${S.compF === 'conferir' ? 'Nenhum comprovante esperando conferência. Quando um responsável mandar o comprovante no WhatsApp da escola, ele aparece aqui.' : 'Nenhum comprovante recebido ainda.'}</div>`; return; }
  box.innerHTML = list.map(cardHtml).join('');
}
function cardHtml(c) {
  const stl = { lendo: 'Lendo…', pendente: 'A conferir', aprovado: 'Baixa dada', rejeitado: 'Rejeitado' }[c.status] || c.status;
  const quem = c.origem === 'whatsapp' ? `${esc(c.remetente || 'Sem nome')}<small>${esc(fmtTel(c.telefone))} · ${esc(tempo(c.recebidoEm))}</small>` : `Enviado pelo painel<small>${esc(tempo(c.recebidoEm))}</small>`;
  let body = '';
  if (c.status === 'lendo') body = `<div class="ia"><span class="spin" aria-hidden="true"></span><span>Lendo o comprovante e procurando o aluno…</span></div>`;
  else {
    body += `<dl class="fields">
      <div><dt>Valor</dt><dd class="big num">${c.valor != null ? BRL.format(c.valor) : '—'}</dd></div>
      <div><dt>Pagador</dt><dd>${esc(c.pagador || '—')}</dd></div>
      <div><dt>Data</dt><dd>${esc(dataBR(c.data) || '—')}${c.hora ? ' ' + esc(c.hora) : ''}</dd></div>
      <div><dt>Banco</dt><dd>${esc(c.banco || '—')}</dd></div>
      <div style="grid-column:span 2"><dt>ID da transação</dt><dd class="mono">${esc(c.idTransacao || '—')}</dd></div></dl>`;
    if (c.legenda) body += `<div class="ia"><b>Mensagem</b><span>${esc(c.legenda)}</span></div>`;
    if (c.status === 'pendente' && c.sugestao.motivo) body += `<div class="ia"><b>Sugestão</b><span>${esc(c.sugestao.motivo)} <span class="muted">(confiança ${esc(c.sugestao.confianca || 'baixa')})</span></span></div>`;
    const w = avisos(c); if (w.length) body += `<div class="warns">${w.map(x => `<div class="warn ${x.bad ? 'bad' : ''}">${esc(x.t)}</div>`).join('')}</div>`;
    if (c.status === 'pendente') body += decideHtml(c);
    if (c.status === 'aprovado') { const a = S.alunos.get(c.alunoId); body += `<div class="done">Baixa em <b>${esc(a?.nome || 'aluno removido')}</b> · ${c.competencias.map(lblMesLongo).map(esc).join(', ')}. <button class="btn sm" data-act="reabrir" data-id="${c.id}">Desfazer</button></div>`; }
    if (c.status === 'rejeitado') body += `<div class="done">Rejeitado. <button class="btn sm" data-act="reabrir" data-id="${c.id}">Voltar para conferência</button></div>`;
  }
  const thumb = c.mime === 'application/pdf' ? `<span class="pdf">PDF</span>` : `<img alt="Comprovante" loading="lazy" src="/api/comprovantes/${c.id}/arquivo">`;
  return `<article class="comp is-${esc(c.status)}"><button class="thumb" data-act="ver" data-id="${c.id}" aria-label="Ver comprovante inteiro">${thumb}</button><div class="comp-body">
    <div class="comp-head"><div class="who">${quem}</div><span class="pill st-${esc(c.status)}">${esc(stl)}</span></div>${body}</div></article>`;
}
function avisos(c) {
  const out = [];
  if (c.status !== 'lendo' && c.pareceComprovante === false) out.push({ t: 'Não reconheci um comprovante de pagamento nesta imagem. Confira pela imagem ou rejeite.', bad: c.valor == null });
  if (c.idTransacao) { const dup = S.e.comprovantes.find(o => o.id !== c.id && o.status !== 'rejeitado' && o.idTransacao === c.idTransacao); if (dup) out.push({ t: `Mesmo ID de transação de outro comprovante (${dup.remetente || 'sem nome'}, ${tempo(dup.recebidoEm)}). Pode ser repetido.`, bad: true }); }
  if (c.status === 'pendente') {
    const s = selDe(c), a = S.alunos.get(+s.alunoId);
    if (a && s.meses.size && c.valor) { const esp = somaMeses(a, [...s.meses]); if (Math.abs(esp - c.valor) > 0.009) out.push({ t: `Valor diferente do esperado: ${BRL.format(c.valor)} pago, ${BRL.format(esp)} para ${s.meses.size} ${s.meses.size > 1 ? 'meses' : 'mês'}.` }); }
    if (c.data && c.data < new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) out.push({ t: `Comprovante antigo: pagamento de ${dataBR(c.data)}.` });
  }
  return out;
}
function decideHtml(c) {
  const s = selDe(c), a = S.alunos.get(+s.alunoId);
  const opts = ativos().map(x => `<option value="${x.id}" ${x.id === +s.alunoId ? 'selected' : ''}>${esc(x.nome)}${x.responsavel ? ' · resp. ' + esc(x.responsavel) : ''}</option>`).join('');
  const ms = a ? meses().filter(m => valorMes(a, m) != null || S.pag.has(`${a.id}|${m}`)).map(m => { const pago = S.pag.has(`${a.id}|${m}`); return `<label class="mchk"><input type="checkbox" data-act="mes" data-id="${c.id}" value="${m}" ${s.meses.has(m) && !pago ? 'checked' : ''} ${pago ? 'disabled' : ''}>${lblMes(m)}/${m.slice(2, 4)}${pago ? ' ✓' : ''}</label>`; }).join('') : '<span class="muted">Escolha o aluno para ver os meses.</span>';
  const ok = a && [...s.meses].some(m => !S.pag.has(`${a.id}|${m}`));
  return `<div class="decide">
    <div class="decide-row"><select data-act="aluno" data-id="${c.id}" aria-label="Aluno"><option value="">Escolha o aluno…</option>${opts}</select></div>
    <div class="decide-row">${ms}</div>
    <div class="decide-row"><button class="btn primary" data-act="confirmar" data-id="${c.id}" ${ok ? '' : 'disabled'}>Confirmar baixa</button><button class="btn danger" data-act="rejeitar" data-id="${c.id}">Rejeitar</button><button class="btn sm" data-act="texto" data-id="${c.id}">Ver texto lido</button></div></div>`;
}
$('#compFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.compF = b.dataset.f; document.querySelectorAll('#compFilter .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); renderComps(); });
$('#comps').addEventListener('change', e => {
  const t = e.target, c = S.e.comprovantes.find(x => x.id === +t.dataset.id); if (!c) return; const s = selDe(c);
  if (t.dataset.act === 'aluno') {
    s.alunoId = t.value; s.meses = new Set(); const a = S.alunos.get(+t.value);
    if (a) { const n = c.valor && a.valor ? Math.max(1, Math.round(c.valor / a.valor)) : 1; emAberto(a).slice(0, n).forEach(m => s.meses.add(m)); }
  }
  if (t.dataset.act === 'mes') t.checked ? s.meses.add(t.value) : s.meses.delete(t.value);
  renderComps();
});
$('#comps').addEventListener('click', async e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const c = S.e.comprovantes.find(x => x.id === +b.dataset.id); if (!c) return;
  const act = b.dataset.act;
  if (act === 'ver') return c.mime === 'application/pdf' ? window.open(`/api/comprovantes/${c.id}/arquivo`, '_blank') : abrirImagem(`/api/comprovantes/${c.id}/arquivo`);
  if (act === 'texto') { const { texto } = await api('GET', `/api/comprovantes/${c.id}/texto`); return modal(`<h3>Texto lido do comprovante</h3><pre class="ocr">${esc(texto || '(nada foi lido)')}</pre><div class="modal-actions"><button class="btn" data-act-reler="${c.id}">Ler de novo</button><button class="btn" data-x>Fechar</button></div>`).querySelector('[data-act-reler]').addEventListener('click', async () => { await api('POST', `/api/comprovantes/${c.id}/reler`); fechar(); }); }
  b.disabled = true;
  try {
    if (act === 'confirmar') {
      const s = selDe(c), a = S.alunos.get(+s.alunoId);
      const ms = [...s.meses].filter(m => !S.pag.has(`${a.id}|${m}`)).sort();
      await api('POST', `/api/comprovantes/${c.id}/confirmar`, { alunoId: a.id, meses: ms });
      toast(`Baixa registrada: ${a.nome} · ${ms.map(lblMes).join(', ')}`);
    }
    if (act === 'rejeitar') await api('POST', `/api/comprovantes/${c.id}/rejeitar`);
    if (act === 'reabrir') { delete S.sel[c.id]; await api('POST', `/api/comprovantes/${c.id}/reabrir`); }
    await carregar();
  } catch (err) { toast(err.message); b.disabled = false; }
});

/* envio manual (foto ou PDF) */
$('#upload').addEventListener('change', async e => {
  const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
  try {
    let base64, mime;
    if (f.type === 'application/pdf') { base64 = await lerBase64(f); mime = 'application/pdf'; }
    else if (f.type.startsWith('image/')) { ({ base64, mime } = await reduzirImagem(f)); }
    else return toast('Envie uma foto, print ou PDF do comprovante.');
    await api('POST', '/api/comprovantes', { base64, mime });
    toast('Comprovante enviado. Lendo…'); await carregar();
  } catch (err) { toast(err.message); }
});
const lerBase64 = f => new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = falha; r.readAsDataURL(f); });
function reduzirImagem(f) {
  return new Promise((ok, falha) => {
    const url = URL.createObjectURL(f), img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, 1800 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      ok({ base64: c.toDataURL('image/jpeg', 0.9).split(',')[1], mime: 'image/jpeg' });
    };
    img.onerror = () => falha(new Error('Não consegui abrir essa imagem.'));
    img.src = url;
  });
}

/* ---------- alunos ---------- */
function renderAlunos() {
  const m = S.mes, q = S.busca.trim().toLowerCase();
  let al = S.e.alunos.slice();
  if (q) al = al.filter(a => (a.nome + ' ' + a.responsavel).toLowerCase().includes(q));
  if (S.alF === 'pago') al = al.filter(a => a.ativo && statusMes(a, m) === 'pago');
  if (S.alF === 'aberto') al = al.filter(a => a.ativo && ['atrasado', 'avencer'].includes(statusMes(a, m)));
  if (S.alF === 'devendo') al = al.filter(a => a.ativo && atrasados(a).length);
  const tb = $('#alunos');
  if (!S.e.alunos.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">Nenhum aluno cadastrado. Use <b>Novo aluno</b> ou <b>Importar lista</b> para colar a lista da planilha.</div></td></tr>`; return; }
  if (!al.length) { tb.innerHTML = `<tr><td colspan="6" class="muted">Nenhum aluno neste filtro.</td></tr>`; return; }
  const ms = meses().filter(k => k <= S.e.mesAtual).slice(-6);
  tb.innerHTML = al.map(a => {
    const div = somaMeses(a, atrasados(a));
    const cells = ms.map(k => { const st = statusMes(a, k); return `<button class="mcell st-${st} ${k === m ? 'sel' : ''}" data-act="mes" data-id="${a.id}" data-m="${k}" title="${esc(lblMesLongo(k))}: ${ST_LBL[st]}">${lblMes(k)}</button>`; }).join('');
    return `<tr${a.ativo ? '' : ' style="opacity:.55"'}><td><div class="nm">${esc(a.nome)}${a.ativo ? '' : ' <span class="pill st-futuro">inativo</span>'}</div><div class="sub">${a.responsavel ? 'Resp.: ' + esc(a.responsavel) + ' · ' : ''}${esc(a.telefone)}</div></td>
      <td>${esc(a.turma)}</td><td class="right num">${BRL.format(a.valor)}</td><td><div class="mstrip">${cells}</div></td>
      <td class="right num">${div ? `<span class="debt">${BRL.format(div)}</span>` : '<span class="muted">—</span>'}</td>
      <td><div class="acts"><button class="btn sm" data-act="financeiro" data-id="${a.id}">Financeiro</button><button class="btn sm" data-act="editar" data-id="${a.id}">Editar</button>${a.ativo && emAberto(a).length ? `<button class="btn sm" data-act="cobrar" data-id="${a.id}">Cobrar</button>` : ''}</div></td></tr>`;
  }).join('');
}
$('#alFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.alF = b.dataset.f; document.querySelectorAll('#alFilter .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); renderAlunos(); });
$('#busca').addEventListener('input', e => { S.busca = e.target.value; renderAlunos(); });
$('#alunos').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = S.alunos.get(+b.dataset.id); if (!a) return;
  if (b.dataset.act === 'editar') modalAluno(a);
  if (b.dataset.act === 'financeiro') modalFinanceiro(a);
  if (b.dataset.act === 'cobrar') modalCobrar(a);
  if (b.dataset.act === 'mes') { const p = S.pag.get(`${a.id}|${b.dataset.m}`); p ? modalPago(a, p) : modalBaixa(a, b.dataset.m); }
});
$('#novoAluno').addEventListener('click', () => modalAluno(null));
$('#importar').addEventListener('click', modalImportar);

/* ---------- modais ---------- */
function modal(html, cls = '') {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay"><div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  const ov = root.firstElementChild;
  ov.addEventListener('click', e => { if (e.target === ov || e.target.closest('[data-x]')) fechar(); });
  setTimeout(() => ov.querySelector('input,select,textarea,button')?.focus(), 0);
  return ov;
}
const fechar = () => { $('#modalRoot').innerHTML = ''; };
document.addEventListener('keydown', e => { if (e.key === 'Escape') fechar(); });
function abrirImagem(src) { modal(`<img src="${esc(src)}" alt="Comprovante ampliado" style="width:100%;border-radius:10px;display:block"><div class="modal-actions"><a class="btn" href="${esc(src)}" target="_blank" rel="noopener">Abrir em tamanho real</a><button class="btn" data-x>Fechar</button></div>`, 'img'); }
function enviarForm(ov, sel, fn) {
  ov.querySelector(sel).addEventListener('submit', async e => {
    e.preventDefault(); const b = e.submitter || e.target.querySelector('button:not([type=button])'); if (b) b.disabled = true;
    try { await fn(new FormData(e.target)); fechar(); await carregar(); } catch (err) { toast(err.message); if (b) b.disabled = false; }
  });
}
function modalAluno(a) {
  const ov = modal(`<h3>${a ? 'Editar aluno' : 'Novo aluno'}</h3><form class="form" id="fAluno">
    <label>Nome do aluno<input name="nome" required value="${esc(a?.nome)}"></label>
    <label>Responsável<input name="responsavel" value="${esc(a?.responsavel)}"></label>
    <div class="row"><label>WhatsApp do responsável<input name="telefone" inputmode="tel" placeholder="(11) 91234-5678" value="${esc(a?.telefone)}"></label>
    <label>Outro telefone<input name="telefone2" inputmode="tel" value="${esc(a?.telefone2)}"><span class="hint">Ex.: do pai, se a mãe também paga.</span></label></div>
    <div class="row"><label>Turma<input name="turma" value="${esc(a?.turma)}"></label>
    <label>Mensalidade (R$)<input name="valor" inputmode="decimal" required value="${a ? String(a.valor).replace('.', ',') : ''}"></label></div>
    <label>Cobrar a partir de<input name="inicio_cobranca" type="month" min="${S.e.config.provisao_inicio}" max="${S.e.config.provisao_fim}" value="${esc(a?.inicio_cobranca || S.e.config.provisao_inicio)}">
    <span class="hint">As mensalidades são geradas com este valor de ${esc(lblMesLongo(S.e.config.provisao_inicio))} até ${esc(lblMesLongo(S.e.config.provisao_fim))}.${a ? ' Se mudar o valor, as mensalidades em aberto do mês atual em diante passam a usar o novo valor; as atrasadas continuam com o valor antigo.' : ''}</span></label>
    ${a ?`<label class="check"><input type="checkbox" name="ativo" ${a.ativo ? 'checked' : ''}> Aluno ativo</label>` : ''}
    <div class="modal-actions">${a ? '<button type="button" class="btn danger" id="apagar" style="margin-right:auto">Apagar</button>' : ''}<button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">Salvar</button></div></form>`);
  enviarForm(ov, '#fAluno', async fd => {
    const d = Object.fromEntries(fd); d.ativo = a ? fd.has('ativo') : true;
    a ? await api('PUT', `/api/alunos/${a.id}`, d) : await api('POST', '/api/alunos', d);
    toast('Aluno salvo.');
  });
  ov.querySelector('#apagar')?.addEventListener('click', e => {
    const b = e.target;
    if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Toque de novo para apagar tudo deste aluno'; return; }
    api('DELETE', `/api/alunos/${a.id}`).then(() => { fechar(); toast('Aluno apagado.'); carregar(); }, err => toast(err.message));
  });
}
function modalImportar() {
  const ov = modal(`<h3>Importar lista de alunos</h3><form class="form" id="fImp">
    <label>Cole aqui, uma linha por aluno<textarea name="lista" required placeholder="Nome do aluno; Responsável; Telefone; Turma; Mensalidade&#10;Ana Souza; Maria Souza; (11) 91234-5678; 1º ano; 480,00"></textarea>
    <span class="hint">Colunas separadas por ponto e vírgula ou TAB (copiar e colar do Excel funciona). Ordem: aluno, responsável, telefone, turma, mensalidade.</span></label>
    <div class="modal-actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">Importar</button></div></form>`);
  enviarForm(ov, '#fImp', async fd => {
    const alunos = String(fd.get('lista')).split('\n').map(l => l.trim()).filter(Boolean)
      .map(l => l.split(/\t|;/).map(x => x.trim()))
      .filter(c => c[0] && !/^nome|^aluno/i.test(c[0]))
      .map(([nome, responsavel = '', telefone = '', turma = '', valor = '0']) => ({ nome, responsavel, telefone, turma, valor: valor.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.') }));
    if (!alunos.length) throw new Error('Não encontrei nenhuma linha válida.');
    const r = await api('POST', '/api/alunos', { alunos });
    toast(`${r.quantos} alunos importados.`);
  });
}
function modalFinanceiro(a) {
  const anos = [...new Set(meses().map(m => m.slice(0, 4)))];
  const tot = { pago: 0, atrasado: 0, avencer: 0 }, qtd = { pago: 0, atrasado: 0, avencer: 0 };
  for (const m of meses()) {
    const st = statusMes(a, m); if (!(st in tot)) continue;
    tot[st] += st === 'pago' ? S.pag.get(`${a.id}|${m}`).valor : valorMes(a, m); qtd[st]++;
  }
  const n = k => `${qtd[k]} ${qtd[k] === 1 ? 'mês' : 'meses'}`;
  const cel = m => {
    const st = statusMes(a, m), p = S.pag.get(`${a.id}|${m}`), v = p ? p.valor : valorMes(a, m);
    if (st === 'sem') return `<div class="fin-cell st-futuro" aria-disabled="true"><b>${lblMes(m)}</b><span>—</span></div>`;
    return `<button class="fin-cell st-${st}" data-m="${m}" title="${esc(lblMesLongo(m))}: ${ST_LBL[st]}"><b>${lblMes(m)}</b><span class="num">${BRL.format(v)}</span><small>${p ? 'pago ' + esc(dataBR(p.data).slice(0, 5)) : ST_LBL[st]}</small></button>`;
  };
  const ov = modal(`<h3>Financeiro · ${esc(a.nome)}</h3>
    <dl class="fields fin-tot">
      <div><dt>Pago</dt><dd class="big num" style="color:var(--ok)">${BRL.format(tot.pago)}</dd><dd class="muted">${n('pago')}</dd></div>
      <div><dt>Em aberto</dt><dd class="big num">${BRL.format(tot.atrasado + tot.avencer)}</dd><dd class="muted">${qtd.atrasado + qtd.avencer} ${qtd.atrasado + qtd.avencer === 1 ? 'mês' : 'meses'}</dd></div>
      <div><dt>Em atraso</dt><dd class="big num" style="color:var(--bad)">${BRL.format(tot.atrasado)}</dd><dd class="muted">${n('atrasado')}</dd></div>
      <div><dt>A vencer</dt><dd class="big num" style="color:var(--info)">${BRL.format(tot.avencer)}</dd><dd class="muted">${n('avencer')}</dd></div>
    </dl>
    ${anos.map(y => `<h4 class="fin-ano">${y}</h4><div class="fin-grid">${meses().filter(m => m.startsWith(y)).map(cel).join('')}</div>`).join('')}
    <p class="hint">Toque num mês para dar baixa ou ver o pagamento. Vencimento todo dia ${esc(S.e.config.vencimento)}.</p>
    <h4 class="fin-ano">Contatos e anotações</h4>
    ${linhaDoTempo(a)}
    <div class="modal-actions">${zapBtn(a)}<button class="btn" data-anotar>Anotar</button>${emAberto(a).length ? '<button class="btn" data-cobrar>Cobrar</button>' : ''}<button class="btn" data-x>Fechar</button></div>`, 'wide');
  ov.querySelector('.modal').addEventListener('click', async e => {
    if (e.target.closest('[data-anotar]')) return modalAnotar(a);
    if (e.target.closest('[data-cobrar]')) return modalCobrar(a);
    const zap = e.target.closest('[data-zap]'); if (zap) return registrarContato(a.id, 'whatsapp', 'Abriu conversa no WhatsApp Web');
    const del = e.target.closest('[data-del-contato]');
    if (del) { if (del.dataset.conf !== '1') { del.dataset.conf = '1'; del.textContent = 'Apagar?'; return; } await api('DELETE', `/api/contatos/${del.dataset.delContato}`).catch(err => toast(err.message)); await carregar(); return modalFinanceiro(S.alunos.get(a.id)); }
    const b = e.target.closest('button[data-m]'); if (!b) return;
    const p = S.pag.get(`${a.id}|${b.dataset.m}`); p ? modalPago(a, p) : modalBaixa(a, b.dataset.m);
  });
}
function modalBaixa(a, m) {
  const opts = meses().filter(k => !S.pag.has(`${a.id}|${k}`) && (valorMes(a, k) != null || k === m)).map(k => `<option value="${k}" data-v="${valorMes(a, k) ?? a.valor}" ${k === m ? 'selected' : ''}>${lblMesLongo(k)}</option>`).join('');
  const ov = modal(`<h3>Dar baixa · ${esc(a.nome)}</h3><form class="form" id="fBaixa">
    <label>Mês de referência<select name="competencia">${opts}</select></label>
    <div class="row"><label>Valor pago<input name="valor" inputmode="decimal" value="${String(valorMes(a, m) ?? a.valor).replace('.', ',')}"></label>
    <label>Forma de pagamento<select name="via"><option>Dinheiro</option><option>Pix</option><option>Cartão</option><option>Boleto</option></select></label></div>
    <label>Data do pagamento<input name="data" type="date" value="${S.e.hoje}"></label>
    <div class="modal-actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">Registrar pagamento</button></div></form>`);
  ov.querySelector('[name=competencia]').addEventListener('change', e => { ov.querySelector('[name=valor]').value = String(e.target.selectedOptions[0].dataset.v).replace('.', ','); });
  enviarForm(ov, '#fBaixa', async fd => {
    const d = Object.fromEntries(fd); d.alunoId = a.id; d.valor = Number(String(d.valor).replace(',', '.'));
    await api('POST', '/api/pagamentos', d); toast(`Baixa registrada: ${a.nome} · ${lblMes(d.competencia)}`);
  });
}
function modalPago(a, p) {
  const ov = modal(`<h3>${esc(a.nome)} · ${esc(lblMesLongo(p.competencia))}</h3>
    <dl class="fields"><div><dt>Valor</dt><dd class="big num">${BRL.format(p.valor)}</dd></div><div><dt>Pago em</dt><dd>${esc(dataBR(p.data))}</dd></div><div><dt>Forma</dt><dd>${esc(p.via)}</dd></div><div><dt>Origem</dt><dd>${p.comprovante_id ? 'Comprovante' : 'Baixa manual'}</dd></div></dl>
    <div class="modal-actions"><button class="btn danger" id="desf">Desfazer baixa</button>${p.comprovante_id ? '<button class="btn" id="verc">Ver comprovante</button>' : ''}<button class="btn" data-x>Fechar</button></div>`);
  ov.querySelector('#desf').addEventListener('click', async () => { try { await api('DELETE', `/api/pagamentos/${p.id}`); fechar(); toast('Baixa desfeita.'); carregar(); } catch (err) { toast(err.message); } });
  ov.querySelector('#verc')?.addEventListener('click', () => abrirImagem(`/api/comprovantes/${p.comprovante_id}/arquivo`));
}
function modalCobrar(a) {
  const ab = emAberto(a), total = somaMeses(a, ab);
  const vars = { responsavel: (a.responsavel || '').split(' ')[0] || 'tudo bem', aluno: a.nome, meses: ab.map(lblMesLongo).join(', '), total: BRL.format(total), escola: S.e.config.escola };
  const msg = S.e.config.texto_cobranca.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  const tel = String(a.telefone).replace(/\D/g, '');
  const podeEnviar = S.wa === 'open' && tel.length >= 10;
  const ov = modal(`<h3>Cobrar ${esc(a.responsavel || a.nome)}</h3><div class="form">
    <label>Mensagem<textarea id="cMsg">${esc(msg)}</textarea></label>
    <div class="hint">WhatsApp: <span class="mono">${esc(a.telefone || 'sem telefone cadastrado')}</span></div></div>
    <div class="modal-actions"><button class="btn" data-x>Fechar</button><button class="btn" id="cCopy">Copiar</button>
    ${tel.length >= 10 ? `<a class="btn ${podeEnviar ? '' : 'primary'}" target="_blank" rel="noopener" id="cWa" href="#">Abrir no WhatsApp Web</a>` : ''}
    ${podeEnviar ? '<button class="btn primary" id="cEnviar">Enviar pelo WhatsApp da escola</button>' : ''}</div>`);
  const t = ov.querySelector('#cMsg');
  const link = ov.querySelector('#cWa'); const upd = () => link && (link.href = waLink(tel, t.value)); upd(); t.addEventListener('input', upd);
  link?.addEventListener('click', () => { registrarContato(a.id, 'cobranca', 'Cobrança aberta no WhatsApp Web'); fechar(); });
  ov.querySelector('#cCopy').addEventListener('click', () => navigator.clipboard.writeText(t.value).then(() => toast('Mensagem copiada.'), () => { t.select(); toast('Selecionei o texto. Copie com Ctrl+C.'); }));
  ov.querySelector('#cEnviar')?.addEventListener('click', async e => { e.target.disabled = true; try { await api('POST', '/api/whatsapp/enviar', { telefone: tel, texto: t.value, alunoId: a.id }); fechar(); toast('Mensagem enviada.'); } catch (err) { toast(err.message); e.target.disabled = false; } });
}

/* ---------- financeiro (cobrança / CRM) ---------- */
const soDigitos = t => String(t || '').replace(/\D/g, '');
const telZap = t => { const d = soDigitos(t); return d.length >= 12 && d.startsWith('55') ? d : d.length >= 10 ? '55' + d : ''; };
// celular abre o app (wa.me); computador abre direto o WhatsApp Web
const waLink = (tel, texto = '') => {
  const n = telZap(tel); const q = texto ? `&text=${encodeURIComponent(texto)}` : '';
  return matchMedia('(pointer:coarse)').matches ? `https://wa.me/${n}${q ? '?' + q.slice(1) : ''}` : `https://web.whatsapp.com/send?phone=${n}${q}`;
};
const ICONE_ZAP = '<svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>';
const zapBtn = (a, cls = '') => telZap(a.telefone) ? `<a class="btn zap ${cls}" data-zap href="${esc(waLink(a.telefone))}" target="_blank" rel="noopener" title="Abrir conversa com ${esc(a.responsavel || a.nome)} no WhatsApp">${ICONE_ZAP}<span>WhatsApp</span></a>` : '';
function registrarContato(alunoId, tipo, texto, promessa = null) {
  return api('POST', '/api/contatos', { alunoId, tipo, texto, promessa }).then(recarregar, err => toast(err.message));
}
const TIPO_CONTATO = { cobranca: 'Cobrança', whatsapp: 'WhatsApp', nota: 'Anotação' };
function linhaDoTempo(a) {
  const cs = S.cont.get(a.id) || [];
  if (!cs.length) return '<p class="muted" style="margin:0">Nenhum contato registrado ainda. Cobranças enviadas pelo sistema e conversas abertas no WhatsApp aparecem aqui sozinhas.</p>';
  return `<ul class="timeline">${cs.slice(0, 30).map(c => `<li><span class="pill ${c.tipo === 'nota' ? 'st-pendente' : 'st-avencer'}">${TIPO_CONTATO[c.tipo] || c.tipo}</span>
    <div><div>${esc(c.texto) || '<span class="muted">(sem texto)</span>'}${c.promessa ? ` <b>· prometeu pagar até ${esc(dataBR(c.promessa))}</b>` : ''}</div><small class="muted">${esc(quandoFoi(c.quando))}</small></div>
    <button class="btn sm" data-del-contato="${c.id}" aria-label="Apagar este registro">×</button></li>`).join('')}</ul>`;
}
function quandoFoi(ms) {
  const dias = Math.floor((new Date(S.e.hoje + 'T23:59:59') - ms) / 864e5);
  const d = new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  return dias <= 0 ? `hoje, ${new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : dias === 1 ? `ontem (${d})` : `há ${dias} dias (${d})`;
}
function modalAnotar(a) {
  const ov = modal(`<h3>Anotar · ${esc(a.nome)}</h3><form class="form" id="fNota">
    <label>O que foi conversado<textarea name="texto" placeholder="Ex.: falei com a mãe por telefone, vai pagar junto com o próximo mês." style="min-height:90px"></textarea></label>
    <label>Prometeu pagar até (opcional)<input type="date" name="promessa" min="${S.e.hoje}"><span class="hint">Aparece no Financeiro como promessa; quando a data passar sem pagamento, o aluno volta para a lista de cobrança.</span></label>
    <div class="modal-actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">Salvar anotação</button></div></form>`);
  enviarForm(ov, '#fNota', async fd => {
    await api('POST', '/api/contatos', { alunoId: a.id, tipo: 'nota', texto: fd.get('texto'), promessa: fd.get('promessa') || null });
    toast('Anotação salva.');
  });
}

S.fin = { visao: 'pessoas', periodo: 'tudo', turma: '', filtro: 'atraso', busca: '', ordem: 'atraso', mes: null };
const mesesPeriodo = () => S.fin.periodo === 'tudo' ? meses() : meses().filter(m => m.startsWith(S.fin.periodo));
const mesVencido = m => m < S.e.mesAtual || (m === S.e.mesAtual && +S.e.hoje.slice(8) > (+S.e.config.vencimento || 10));
const alunosFin = () => S.e.alunos.filter(a => !S.fin.turma || (a.turma || '(sem turma)') === S.fin.turma);
function resumo(a, ms = mesesPeriodo()) {
  const r = { pago: 0, nPago: 0, atraso: 0, nAtraso: 0, desde: null, avencer: 0, nAvencer: 0, previsto: 0, pagoVencido: 0 };
  for (const m of ms) {
    const p = S.pag.get(`${a.id}|${m}`), v = valorMes(a, m);
    if (v != null) r.previsto += v;
    if (p) { r.pago += p.valor; r.nPago++; if (mesVencido(m)) r.pagoVencido += p.valor; continue; }
    if (v == null) continue;
    if (mesVencido(m)) { r.atraso += v; r.nAtraso++; r.desde ||= m; } else { r.avencer += v; r.nAvencer++; }
  }
  const pags = S.e.pagamentos.filter(p => p.aluno_id === a.id).sort((x, y) => y.data.localeCompare(x.data));
  r.ultimoPag = pags[0] || null;
  const cs = S.cont.get(a.id) || [];
  r.ultimoContato = cs[0] || null;
  const prom = cs.find(c => c.promessa);
  r.promessa = prom && prom.quando >= (r.ultimoPag ? new Date(r.ultimoPag.data + 'T00:00:00').getTime() : 0) ? prom.promessa : null; // promessa ainda não cumprida
  r.semContato = !r.ultimoContato || Date.now() - r.ultimoContato.quando > 7 * 864e5;
  return r;
}

function renderFin() {
  if (!S.e) return;
  // período e turma
  const anos = [...new Set(meses().map(m => m.slice(0, 4)))];
  const selP = $('#finPeriodo');
  selP.innerHTML = `<option value="tudo">${esc(lblMesLongo(meses()[0]))} a ${esc(lblMesLongo(meses().at(-1)))}</option>` + anos.map(y => `<option value="${y}">Ano de ${y}</option>`).join('');
  if (S.fin.periodo !== 'tudo' && !anos.includes(S.fin.periodo)) S.fin.periodo = 'tudo';
  selP.value = S.fin.periodo;
  const turmas = [...new Set(S.e.alunos.map(a => a.turma || '(sem turma)'))].sort((x, y) => x.localeCompare(y, 'pt-BR', { numeric: true }));
  $('#finTurma').innerHTML = `<option value="">Todas as turmas</option>` + turmas.map(t => `<option ${t === S.fin.turma ? 'selected' : ''}>${esc(t)}</option>`).join('');
  document.querySelectorAll('#finVisao button').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === S.fin.visao));

  const lista = alunosFin().map(a => ({ a, r: resumo(a) }));
  const tot = lista.reduce((t, { r }) => { for (const k of ['pago', 'atraso', 'avencer', 'previsto', 'pagoVencido']) t[k] += r[k]; return t; }, { pago: 0, atraso: 0, avencer: 0, previsto: 0, pagoVencido: 0 });
  const devedores = lista.filter(x => x.r.atraso > 0);
  const inad = tot.atraso + tot.pagoVencido ? tot.atraso / (tot.atraso + tot.pagoVencido) * 100 : 0;
  const pct = tot.previsto ? tot.pago / tot.previsto * 100 : 0;
  $('#cntFin').textContent = S.e.alunos.filter(a => resumo(a, meses()).atraso > 0).length;
  $('#cntFin').classList.toggle('hot', +$('#cntFin').textContent > 0);
  $('#finKpis').innerHTML = `
    <div class="kpi"><div class="label">Recebido no período</div><div class="v num" style="color:var(--ok)">${BRL.format(tot.pago)}</div>
      <div class="s num">de ${BRL.format(tot.previsto)} previstos · ${pct.toFixed(0)}%</div>
      <div class="bar" role="img" aria-label="${pct.toFixed(0)}% recebido"><i style="width:${Math.min(100, pct)}%;background:var(--ok)"></i><i style="width:${tot.previsto ? Math.min(100, tot.atraso / tot.previsto * 100) : 0}%;background:var(--bad)"></i></div></div>
    <div class="kpi"><div class="label">Em atraso</div><div class="v num" style="color:var(--bad)">${BRL.format(tot.atraso)}</div><div class="s">${devedores.length} ${devedores.length === 1 ? 'aluno devendo' : 'alunos devendo'}</div></div>
    <div class="kpi"><div class="label">A vencer</div><div class="v num" style="color:var(--info)">${BRL.format(tot.avencer)}</div><div class="s">ainda dentro do prazo</div></div>
    <div class="kpi"><div class="label">Inadimplência</div><div class="v num">${inad.toFixed(1).replace('.', ',')}%</div><div class="s">do que já venceu, quanto não foi pago</div></div>`;

  renderRotina();
  const corpo = $('#finCorpo');
  if (!S.e.alunos.length) { corpo.innerHTML = '<div class="empty">Cadastre os alunos na aba Alunos para ver o financeiro.</div>'; return; }
  if (S.fin.visao === 'meses') corpo.innerHTML = finMeses();
  else if (S.fin.visao === 'turmas') corpo.innerHTML = finTurmas();
  else corpo.innerHTML = finPessoas(lista);
}

function renderRotina() {
  const conferir = S.e.comprovantes.filter(c => c.status === 'pendente' || c.status === 'lendo').length;
  const todos = S.e.alunos.map(a => ({ a, r: resumo(a, meses()) }));
  const prom = todos.filter(x => x.r.promessa && x.r.promessa < S.e.hoje && x.r.atraso > 0).length;
  const sem = todos.filter(x => x.r.atraso > 0 && x.r.semContato).length;
  let uv = null; try { uv = JSON.parse(S.e.config.ultima_varredura || 'null'); } catch {}
  const busca = uv ? `Última busca ${esc(quandoFoi(uv.em))}: ${uv.encontradas} ${uv.encontradas === 1 ? 'imagem/PDF' : 'imagens/PDFs'}, ${uv.novas} ${uv.novas === 1 ? 'nova' : 'novas'}.` : 'Nenhuma busca feita ainda.';
  $('#finRotina').innerHTML = `<div class="card rotina">
    <div><h2>Rotina da segunda-feira</h2><p class="muted" style="margin:0">Ao ligar o computador o sistema já busca sozinho os comprovantes da semana. Siga a ordem abaixo.</p></div>
    <ol class="passos">
      <li><b>Buscar comprovantes</b><span class="muted">${busca}</span><button class="btn sm primary" id="finVarrer">Buscar dos últimos 7 dias</button></li>
      <li><b>Conferir</b><span class="muted">${conferir ? `${conferir} ${conferir === 1 ? 'comprovante esperando' : 'comprovantes esperando'} você.` : 'Nenhum comprovante para conferir.'}</span><button class="btn sm" data-ir="comprovantes" ${conferir ? '' : 'disabled'}>Abrir comprovantes</button></li>
      <li><b>Cobrar</b><span class="muted">${sem} ${sem === 1 ? 'devedor' : 'devedores'} sem contato há 7 dias${prom ? ` · ${prom} ${prom === 1 ? 'promessa vencida' : 'promessas vencidas'}` : ''}.</span><button class="btn sm" data-filtro-rapido="${prom ? 'promessa' : 'semcontato'}" ${sem || prom ? '' : 'disabled'}>Ver lista</button></li>
    </ol></div>`;
}

const FILTROS = { todos: 'Todos', atraso: 'Em atraso', emdia: 'Em dia', semcontato: 'Sem contato há 7 dias', promessa: 'Com promessa' };
function finPessoas(lista) {
  const f = S.fin, q = f.busca.trim().toLowerCase();
  let l = lista;
  if (f.mes) l = l.filter(({ a }) => statusMes(a, f.mes) === 'atrasado' || statusMes(a, f.mes) === 'avencer');
  if (q) l = l.filter(({ a }) => `${a.nome} ${a.responsavel} ${a.telefone}`.toLowerCase().includes(q));
  if (f.filtro === 'atraso') l = l.filter(x => x.r.atraso > 0);
  if (f.filtro === 'emdia') l = l.filter(x => x.r.atraso === 0);
  if (f.filtro === 'semcontato') l = l.filter(x => x.r.atraso > 0 && x.r.semContato);
  if (f.filtro === 'promessa') l = l.filter(x => x.r.promessa);
  const ord = { atraso: (x, y) => y.r.atraso - x.r.atraso || (x.r.desde || '9').localeCompare(y.r.desde || '9'), antigo: (x, y) => (x.r.desde || '9').localeCompare(y.r.desde || '9'), nome: (x, y) => x.a.nome.localeCompare(y.a.nome, 'pt-BR'), contato: (x, y) => (x.r.ultimoContato?.quando || 0) - (y.r.ultimoContato?.quando || 0), pago: (x, y) => y.r.pago - x.r.pago };
  l = l.slice().sort(ord[f.ordem] || ord.atraso);
  const somaAtraso = l.reduce((s, x) => s + x.r.atraso, 0);
  const linhas = l.map(({ a, r }) => {
    const atraso = r.atraso ? `<span class="debt">${BRL.format(r.atraso)}</span><div class="sub">${r.nAtraso} ${r.nAtraso === 1 ? 'mês' : 'meses'} · desde ${esc(lblMes(r.desde))}/${r.desde.slice(2, 4)}</div>` : '<span class="pill st-pago">Em dia</span>';
    const up = r.ultimoPag ? `${esc(dataBR(r.ultimoPag.data))}<div class="sub">${esc(lblMes(r.ultimoPag.competencia))}/${r.ultimoPag.competencia.slice(2, 4)} · ${esc(r.ultimoPag.via)}</div>` : '<span class="muted">Nunca</span>';
    const uc = r.ultimoContato ? `${esc(quandoFoi(r.ultimoContato.quando))}<div class="sub">${esc(TIPO_CONTATO[r.ultimoContato.tipo])}${r.ultimoContato.texto && r.ultimoContato.tipo === 'nota' ? ': ' + esc(r.ultimoContato.texto.slice(0, 40)) : ''}</div>` : '<span class="muted">Nenhum</span>';
    const prom = r.promessa ? `<div><span class="pill ${r.promessa < S.e.hoje ? 'st-atrasado' : 'st-pendente'}">Promessa ${esc(dataBR(r.promessa).slice(0, 5))}</span></div>` : '';
    return `<tr${a.ativo ? '' : ' style="opacity:.6"'}><td><button class="linkbtn" data-hist="${a.id}"><span class="nm">${esc(a.nome)}</span></button>${a.ativo ? '' : ' <span class="pill st-futuro">inativo</span>'}<div class="sub">${a.responsavel ? esc(a.responsavel) + ' · ' : ''}${esc(a.turma || 'sem turma')}</div></td>
      <td class="right num">${BRL.format(r.pago)}<div class="sub">${r.nPago} ${r.nPago === 1 ? 'mês' : 'meses'}</div></td>
      <td class="right num">${atraso}</td>
      <td class="right num">${r.avencer ? BRL.format(r.avencer) : '<span class="muted">—</span>'}</td>
      <td>${up}</td><td>${uc}${prom}</td>
      <td><div class="acts">${zapBtn(a, 'sm')}${r.atraso || r.avencer ? `<button class="btn sm" data-cobrar="${a.id}">Cobrar</button>` : ''}<button class="btn sm" data-anotar="${a.id}">Anotar</button><button class="btn sm" data-hist="${a.id}">Histórico</button></div></td></tr>`;
  }).join('');
  return `<div class="toolbar">
      <div class="chips" id="finFiltro">${Object.entries(FILTROS).map(([k, v]) => `<button class="chip" aria-pressed="${k === f.filtro}" data-f="${k}">${v}</button>`).join('')}</div>
      <div class="grp"><input class="search" id="finBusca" type="search" placeholder="Buscar aluno, responsável ou telefone" aria-label="Buscar" value="${esc(f.busca)}">
      <select class="search sel" id="finOrdem" aria-label="Ordenar">${Object.entries({ atraso: 'Maior dívida', antigo: 'Atraso mais antigo', contato: 'Contato mais antigo', pago: 'Quem mais pagou', nome: 'Nome' }).map(([k, v]) => `<option value="${k}" ${k === f.ordem ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <button class="btn" id="finCsv">Baixar lista (Excel)</button></div></div>
    ${f.mes ? `<div class="notice fin-mes">Mostrando quem tem a mensalidade de <b>${esc(lblMesLongo(f.mes))}</b> em aberto. <button class="btn sm" data-limpar-mes>Mostrar todos os meses</button></div>` : ''}
    <div class="tablewrap"><table class="fin-tab">
      <thead><tr><th>Aluno</th><th class="right">Pago</th><th class="right">Em atraso</th><th class="right">A vencer</th><th>Último pagamento</th><th>Último contato</th><th class="right">Ações</th></tr></thead>
      <tbody>${linhas || `<tr><td colspan="7"><div class="empty">${f.filtro === 'atraso' ? 'Ninguém em atraso neste filtro. 🎉' : 'Nenhum aluno neste filtro.'}</div></td></tr>`}</tbody>
      ${l.length ? `<tfoot><tr><td><b>${l.length} ${l.length === 1 ? 'aluno' : 'alunos'}</b></td><td class="right num"><b>${BRL.format(l.reduce((s, x) => s + x.r.pago, 0))}</b></td><td class="right num"><b class="debt">${BRL.format(somaAtraso)}</b></td><td class="right num"><b>${BRL.format(l.reduce((s, x) => s + x.r.avencer, 0))}</b></td><td colspan="3"></td></tr></tfoot>` : ''}
    </table></div>`;
}

function finMeses() {
  const al = alunosFin();
  const linhas = mesesPeriodo().map(m => {
    let previsto = 0, recebido = 0, atraso = 0, avencer = 0, nDev = 0;
    for (const a of al) {
      const p = S.pag.get(`${a.id}|${m}`), v = valorMes(a, m);
      if (v != null) previsto += v;
      if (p) { recebido += p.valor; continue; }
      if (v == null) continue;
      if (mesVencido(m)) { atraso += v; nDev++; } else avencer += v;
    }
    return { m, previsto, recebido, atraso, avencer, nDev };
  });
  const t = linhas.reduce((s, x) => { for (const k of ['previsto', 'recebido', 'atraso', 'avencer']) s[k] += x[k]; return s; }, { previsto: 0, recebido: 0, atraso: 0, avencer: 0 });
  const barra = x => { const b = x.previsto || 1; return `<div class="bar mini" role="img" aria-label="${(x.recebido / b * 100).toFixed(0)}% recebido"><i style="width:${x.recebido / b * 100}%;background:var(--ok)"></i><i style="width:${x.atraso / b * 100}%;background:var(--bad)"></i><i style="width:${x.avencer / b * 100}%;background:var(--info);opacity:.5"></i></div>`; };
  return `<div class="tablewrap"><table class="fin-tab">
    <thead><tr><th>Mês</th><th class="right">Previsto</th><th class="right">Recebido</th><th class="right">Em atraso</th><th class="right">A vencer</th><th style="width:22%">Situação</th><th></th></tr></thead>
    <tbody>${linhas.map(x => `<tr class="${x.m === S.e.mesAtual ? 'atual' : ''}"><td><b>${esc(lblMesLongo(x.m).replace(/^./, c => c.toUpperCase()))}</b>${x.m === S.e.mesAtual ? ' <span class="pill st-avencer">atual</span>' : ''}</td>
      <td class="right num">${BRL.format(x.previsto)}</td><td class="right num" style="color:var(--ok)">${BRL.format(x.recebido)}</td>
      <td class="right num">${x.atraso ? `<span class="debt">${BRL.format(x.atraso)}</span><div class="sub">${x.nDev} ${x.nDev === 1 ? 'aluno' : 'alunos'}</div>` : '<span class="muted">—</span>'}</td>
      <td class="right num">${x.avencer ? BRL.format(x.avencer) : '<span class="muted">—</span>'}</td><td>${barra(x)}</td>
      <td class="right">${x.atraso || x.avencer ? `<button class="btn sm" data-ver-mes="${x.m}">Quem deve</button>` : ''}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td><b>Total</b></td><td class="right num"><b>${BRL.format(t.previsto)}</b></td><td class="right num"><b style="color:var(--ok)">${BRL.format(t.recebido)}</b></td><td class="right num"><b class="debt">${BRL.format(t.atraso)}</b></td><td class="right num"><b>${BRL.format(t.avencer)}</b></td><td>${barra(t)}</td><td></td></tr></tfoot>
  </table></div><p class="hint" style="margin-top:8px"><span class="leg" style="--c:var(--ok)"></span>recebido <span class="leg" style="--c:var(--bad)"></span>em atraso <span class="leg" style="--c:var(--info)"></span>a vencer</p>`;
}

function finTurmas() {
  const grupos = new Map();
  for (const a of alunosFin()) { const t = a.turma || '(sem turma)'; if (!grupos.has(t)) grupos.set(t, []); grupos.get(t).push(a); }
  const linhas = [...grupos].sort((x, y) => x[0].localeCompare(y[0], 'pt-BR', { numeric: true })).map(([turma, als]) => {
    const rs = als.map(a => resumo(a));
    const s = k => rs.reduce((t, r) => t + r[k], 0);
    const atraso = s('atraso'), venc = atraso + s('pagoVencido');
    return { turma, n: als.filter(a => a.ativo).length, previsto: s('previsto'), pago: s('pago'), atraso, avencer: s('avencer'), dev: rs.filter(r => r.atraso > 0).length, inad: venc ? atraso / venc * 100 : 0 };
  });
  return `<div class="tablewrap"><table class="fin-tab">
    <thead><tr><th>Turma</th><th class="right">Alunos</th><th class="right">Previsto</th><th class="right">Recebido</th><th class="right">Em atraso</th><th class="right">A vencer</th><th class="right">Devedores</th><th class="right">Inadimplência</th><th></th></tr></thead>
    <tbody>${linhas.map(x => `<tr><td><b>${esc(x.turma)}</b></td><td class="right num">${x.n}</td><td class="right num">${BRL.format(x.previsto)}</td><td class="right num" style="color:var(--ok)">${BRL.format(x.pago)}</td>
      <td class="right num">${x.atraso ? `<span class="debt">${BRL.format(x.atraso)}</span>` : '<span class="muted">—</span>'}</td><td class="right num">${BRL.format(x.avencer)}</td>
      <td class="right num">${x.dev}</td><td class="right num"><span class="pill ${x.inad >= 20 ? 'st-atrasado' : x.inad >= 5 ? 'st-pendente' : 'st-pago'}">${x.inad.toFixed(1).replace('.', ',')}%</span></td>
      <td class="right"><button class="btn sm" data-ver-turma="${esc(x.turma)}">Ver alunos</button></td></tr>`).join('')}</tbody>
  </table></div>`;
}

function baixarCsvFin() {
  const lista = alunosFin().map(a => ({ a, r: resumo(a) })).filter(x => S.fin.filtro !== 'atraso' || x.r.atraso > 0);
  const n = v => v.toFixed(2).replace('.', ',');
  const linhas = [['Aluno', 'Responsável', 'Telefone', 'Turma', 'Pago', 'Em atraso', 'Meses em atraso', 'Atrasado desde', 'A vencer', 'Último pagamento', 'Último contato', 'Promessa']];
  for (const { a, r } of lista.sort((x, y) => y.r.atraso - x.r.atraso))
    linhas.push([a.nome, a.responsavel, a.telefone, a.turma, n(r.pago), n(r.atraso), r.nAtraso, r.desde ? lblMesLongo(r.desde) : '', n(r.avencer), r.ultimoPag ? dataBR(r.ultimoPag.data) : '', r.ultimoContato ? new Date(r.ultimoContato.quando).toLocaleDateString('pt-BR') : '', r.promessa ? dataBR(r.promessa) : '']);
  const csv = '﻿' + linhas.map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const el = Object.assign(document.createElement('a'), { href: url, download: `financeiro-${S.e.hoje}.csv` }); el.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function varrer(botao) {
  botao.disabled = true; botao.innerHTML = '<span class="spin" aria-hidden="true"></span> Buscando…';
  try {
    const r = await api('POST', '/api/whatsapp/varrer', { dias: 7 });
    toast(r.novas ? `${r.novas} ${r.novas === 1 ? 'comprovante novo encontrado' : 'comprovantes novos encontrados'}. Confira na aba Comprovantes.` : `Nenhum comprovante novo (${r.encontradas} já estavam no sistema).`, r.novas ? 'new' : '');
    await carregar();
  } catch (err) { toast(err.message); botao.disabled = false; botao.textContent = 'Buscar dos últimos 7 dias'; }
}

$('#p-financeiro').addEventListener('click', e => {
  const t = e.target;
  const v = t.closest('#finVisao [data-v]'); if (v) { S.fin.visao = v.dataset.v; return renderFin(); }
  const fb = t.closest('#finFiltro [data-f]'); if (fb) { S.fin.filtro = fb.dataset.f; return renderFin(); }
  const fr = t.closest('[data-filtro-rapido]'); if (fr) { Object.assign(S.fin, { visao: 'pessoas', filtro: fr.dataset.filtroRapido, mes: null }); renderFin(); return $('#finCorpo').scrollIntoView({ behavior: 'smooth' }); }
  if (t.closest('[data-ir]')) return abrirAba(t.closest('[data-ir]').dataset.ir);
  if (t.closest('#finVarrer')) return varrer(t.closest('#finVarrer'));
  if (t.closest('#finCsv')) return baixarCsvFin();
  if (t.closest('[data-limpar-mes]')) { S.fin.mes = null; return renderFin(); }
  const vm = t.closest('[data-ver-mes]'); if (vm) { Object.assign(S.fin, { visao: 'pessoas', mes: vm.dataset.verMes, filtro: 'todos' }); return renderFin(); }
  const vt = t.closest('[data-ver-turma]'); if (vt) { Object.assign(S.fin, { visao: 'pessoas', turma: vt.dataset.verTurma }); return renderFin(); }
  const zap = t.closest('[data-zap]'); if (zap) { const a = S.alunos.get(+zap.closest('tr')?.querySelector('[data-hist]')?.dataset.hist); if (a) registrarContato(a.id, 'whatsapp', 'Abriu conversa no WhatsApp Web'); return; }
  const id = +(t.closest('[data-cobrar]')?.dataset.cobrar || t.closest('[data-anotar]')?.dataset.anotar || t.closest('[data-hist]')?.dataset.hist);
  const a = S.alunos.get(id); if (!a) return;
  if (t.closest('[data-cobrar]')) modalCobrar(a); else if (t.closest('[data-anotar]')) modalAnotar(a); else modalFinanceiro(a);
});
$('#p-financeiro').addEventListener('input', e => {
  if (e.target.id !== 'finBusca') return;
  S.fin.busca = e.target.value; const pos = e.target.selectionStart;
  renderFin(); const b = $('#finBusca'); b.focus(); b.setSelectionRange(pos, pos);
});
$('#p-financeiro').addEventListener('change', e => {
  if (e.target.id === 'finPeriodo') { S.fin.periodo = e.target.value; S.fin.mes = null; }
  if (e.target.id === 'finTurma') S.fin.turma = e.target.value;
  if (e.target.id === 'finOrdem') S.fin.ordem = e.target.value;
  renderFin();
});

/* ---------- WhatsApp ---------- */
const WA_LBL = { open: ['Conectado', 'on'], connecting: ['Aguardando QR Code', ''], close: ['Desconectado', 'off'], inexistente: ['Não conectado', 'off'], 'nao-configurado': ['Não configurado', 'off'], 'fora-do-ar': ['Serviço fora do ar', 'off'] };
async function atualizarWa() {
  try { S.wa = (await api('GET', '/api/whatsapp')).estado; } catch { S.wa = 'fora-do-ar'; }
  const [t, c] = WA_LBL[S.wa] || [S.wa, ''];
  const dot = $('#waDot'); dot.textContent = 'WhatsApp: ' + t; dot.className = 'wa-dot ' + c;
  return S.wa;
}
let qrTimer;
async function verWhatsapp() {
  const card = $('#waCard'); const st = await atualizarWa();
  clearInterval(qrTimer);
  if (st === 'open') { card.innerHTML = `<h2>Conexão</h2><p><span class="pill st-pago">Conectado</span></p><p class="muted">Os comprovantes que chegarem no WhatsApp da escola aparecem na aba Comprovantes.</p><div class="modal-actions" style="justify-content:flex-start"><button class="btn danger" id="waSair">Desconectar</button></div>`;
    card.querySelector('#waSair').addEventListener('click', async e => { const b = e.target; if (b.dataset.conf !== '1') { b.dataset.conf = '1'; b.textContent = 'Toque de novo para desconectar'; return; } await api('POST', '/api/whatsapp/desconectar').catch(err => toast(err.message)); verWhatsapp(); });
    return; }
  if (st === 'nao-configurado' || st === 'fora-do-ar') { card.innerHTML = `<h2>Conexão</h2><p class="warn bad">${st === 'nao-configurado' ? 'A Evolution API não está configurada no servidor (.env).' : 'O serviço do WhatsApp ainda não respondeu. Se o computador acabou de ligar, espere 1 ou 2 minutos e abra esta aba de novo. Se continuar, veja "Problemas comuns" no guia.'}</p>`; return; }
  card.innerHTML = `<h2>Conexão</h2><p class="muted">O WhatsApp da escola ainda não está ligado ao sistema.</p><div class="modal-actions" style="justify-content:flex-start"><button class="btn primary" id="waQr">Gerar QR Code</button></div><div id="qrBox"></div>`;
  card.querySelector('#waQr').addEventListener('click', gerarQr);
}
async function gerarQr() {
  const box = $('#qrBox'); box.innerHTML = '<p class="muted"><span class="spin"></span> Gerando QR Code…</p>';
  try {
    const r = await api('POST', '/api/whatsapp/conectar');
    if (r.estado === 'open') return verWhatsapp();
    box.innerHTML = r.qr ? `<div class="qr"><img src="${esc(r.qr)}" alt="QR Code para conectar o WhatsApp"></div><p class="hint">O QR Code se renova sozinho a cada 30 segundos enquanto esta tela estiver aberta.</p>` : '<p class="warn">O WhatsApp ainda não gerou o QR Code. Toque em Gerar QR Code de novo em alguns segundos. Se continuar assim, veja "Problemas comuns" no guia.</p>';
    clearInterval(qrTimer); let n = 0;
    qrTimer = setInterval(async () => {
      if ((await atualizarWa()) === 'open') { clearInterval(qrTimer); toast('WhatsApp conectado!'); return verWhatsapp(); }
      if (++n % 10 === 0 && !$('#p-whatsapp').hidden) { clearInterval(qrTimer); gerarQr(); } // novo QR a cada ~30 s
      if (n > 100) clearInterval(qrTimer);
    }, 3000);
  } catch (err) { box.innerHTML = `<p class="warn bad">${esc(err.message)}</p>`; }
}

/* ---------- ajustes ---------- */
function preencherAjustes() {
  const c = S.e.config, f = $('#fAjustes');
  f.escola.value = c.escola; f.vencimento.value = c.vencimento; f.provisao_inicio.value = c.provisao_inicio; f.provisao_fim.value = c.provisao_fim;
  f.resposta_recebido.checked = c.resposta_recebido === '1'; f.resposta_confirmado.checked = c.resposta_confirmado === '1';
  f.texto_recebido.value = c.texto_recebido; f.texto_confirmado.value = c.texto_confirmado; f.texto_cobranca.value = c.texto_cobranca;
}
$('#fAjustes').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  const d = { escola: f.escola.value, vencimento: f.vencimento.value, provisao_inicio: f.provisao_inicio.value, provisao_fim: f.provisao_fim.value, resposta_recebido: f.resposta_recebido.checked ? '1' : '0', resposta_confirmado: f.resposta_confirmado.checked ? '1' : '0', texto_recebido: f.texto_recebido.value, texto_confirmado: f.texto_confirmado.value, texto_cobranca: f.texto_cobranca.value };
  try { await api('PUT', '/api/config', d); toast('Ajustes salvos.'); await carregar(); } catch (err) { toast(err.message); }
});
$('#sair').addEventListener('click', async () => { await api('POST', '/api/sair').catch(() => {}); location.replace('/entrar'); });

/* ---------- avisos ---------- */
function toast(t, cls = '') { const el = document.createElement('div'); el.className = 'toast ' + cls; el.textContent = t; $('#toasts').append(el); setTimeout(() => el.remove(), 5000); }
let audio; document.addEventListener('pointerdown', () => { try { audio ||= new AudioContext(); } catch {} }, { once: true });
function plim() { if (!audio) return; try { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.15, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .5); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .5); } catch {} }
const notice = t => { const n = $('#notice'); n.hidden = !t; n.textContent = t || ''; };

function renderAll() {
  renderMonths(); renderKpis(); renderComps(); renderAlunos();
  renderFin();
}

/* ---------- início ---------- */
function conectarEventos() {
  const es = new EventSource('/api/eventos');
  es.addEventListener('comprovante', ev => {
    const d = JSON.parse(ev.data);
    if (d.novo) { toast(`Novo comprovante: ${d.remetente || 'enviado pelo painel'}`, 'new'); plim(); }
    recarregar();
  });
  es.addEventListener('dados', recarregar);
  es.addEventListener('whatsapp', () => atualizarWa());
  es.onopen = () => notice('');
  es.onerror = () => notice('Sem conexão com o servidor. Tentando reconectar…');
}
carregar().then(() => { abrirAba(location.hash.slice(1)); conectarEventos(); atualizarWa(); setInterval(atualizarWa, 60_000); setInterval(renderComps, 60_000); })
  .catch(err => notice('Não consegui carregar os dados: ' + err.message));
