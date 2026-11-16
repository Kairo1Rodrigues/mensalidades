// Painel do Mensalidades em Dia.
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MES_LONGO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const lblMes = k => MES[+k.slice(5) - 1];
const lblMesLongo = k => MES_LONGO[+k.slice(5) - 1] + ' de ' + k.slice(0, 4);
const dataBR = iso => (iso ? iso.split('-').reverse().join('/') : '');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const $ = s => document.querySelector(s);

const S = { e: null, pag: new Map(), alunos: new Map(), mes: null, compF: 'conferir', alF: 'todos', busca: '', sel: {}, wa: null };

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
  if (!S.mes || !e.competencias.includes(S.mes)) S.mes = e.mesAtual;
  renderAll();
}
let recarregando = null;
const recarregar = () => { clearTimeout(recarregando); recarregando = setTimeout(() => carregar().catch(() => {}), 150); };

/* ---------- regras ---------- */
const meses = () => S.e.competencias;
const ativos = () => S.e.alunos.filter(a => a.ativo);
function statusMes(a, m) {
  if (S.pag.has(`${a.id}|${m}`)) return 'pago';
  const atual = S.e.mesAtual;
  if (m < atual) return 'atrasado';
  if (m === atual) return +S.e.hoje.slice(8) > (+S.e.config.vencimento || 10) ? 'atrasado' : 'avencer';
  return 'futuro';
}
const ST_LBL = { pago: 'Pago', atrasado: 'Atrasado', avencer: 'A vencer', futuro: 'Futuro' };
const emAberto = a => meses().filter(m => m <= S.e.mesAtual && statusMes(a, m) !== 'pago');
const atrasados = a => meses().filter(m => statusMes(a, m) === 'atrasado');

/* ---------- topo e resumo ---------- */
function renderMonths() {
  const ms = meses().filter(m => m <= S.e.mesAtual).slice(-6);
  $('#months').innerHTML = ms.map(m => `<button aria-pressed="${m === S.mes}" data-m="${m}"><small>${m.slice(0, 4)}</small>${lblMes(m)}${m === S.e.mesAtual ? ' · atual' : ''}</button>`).join('');
}
$('#months').addEventListener('click', e => { const b = e.target.closest('[data-m]'); if (b) { S.mes = b.dataset.m; renderAll(); } });

function renderKpis() {
  const al = ativos(), m = S.mes;
  const previsto = al.reduce((s, a) => s + a.valor, 0);
  const recebido = al.reduce((s, a) => s + (S.pag.get(`${a.id}|${m}`)?.valor || 0), 0);
  const pagos = al.filter(a => statusMes(a, m) === 'pago').length;
  const abertos = al.filter(a => statusMes(a, m) !== 'pago');
  const atraso = al.reduce((s, a) => s + atrasados(a).length * a.valor, 0);
  const devedores = al.filter(a => atrasados(a).length).length;
  const conferir = S.e.comprovantes.filter(c => c.status === 'pendente' || c.status === 'lendo').length;
  const pct = previsto ? Math.min(100, recebido / previsto * 100) : 0;
  $('#kpis').innerHTML = `
    <div class="kpi"><div class="label">Recebido em ${esc(lblMesLongo(m))}</div><div class="v num">${BRL.format(recebido)}</div>
      <div class="s num">de ${BRL.format(previsto)} previstos · ${pct.toFixed(0)}%</div>
      <div class="bar" role="img" aria-label="${pct.toFixed(0)}% recebido"><i style="width:${pct}%;background:var(--ok)"></i></div></div>
    <div class="kpi"><div class="label">Pagaram</div><div class="v num">${pagos}<span class="muted" style="font-size:16px"> / ${al.length}</span></div><div class="s">alunos neste mês</div></div>
    <div class="kpi"><div class="label">Em aberto</div><div class="v num">${abertos.length}</div><div class="s num">${BRL.format(abertos.reduce((s, a) => s + a.valor, 0))} a receber</div></div>
    <div class="kpi ${conferir ? 'alert' : ''}"><div class="label">A conferir</div><div class="v num">${conferir}</div><div class="s num">${conferir ? 'comprovantes esperando você' : 'nenhum comprovante novo'} · atraso total ${BRL.format(atraso)} (${devedores} alunos)</div></div>`;
  const cc = $('#cntComp'); cc.textContent = conferir; cc.classList.toggle('hot', conferir > 0);
  $('#cntAlunos').textContent = al.length;
  $('#escolaNome').textContent = S.e.config.escola;
  document.title = (conferir ? `(${conferir}) ` : '') + 'Mensalidades em Dia';
}

/* ---------- abas ---------- */
const TABS = ['comprovantes', 'alunos', 'whatsapp', 'ajustes'];
function abrirAba(t) {
  if (!TABS.includes(t)) t = 'comprovantes';
  document.querySelectorAll('.tabs [data-tab]').forEach(x => x.setAttribute('aria-selected', x.dataset.tab === t));
  TABS.forEach(x => $('#p-' + x).hidden = x !== t);
  if (t === 'whatsapp') verWhatsapp();
  if (t === 'ajustes') preencherAjustes();
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
    if (a && s.meses.size && c.valor) { const esp = a.valor * s.meses.size; if (Math.abs(esp - c.valor) > 0.009) out.push({ t: `Valor diferente do esperado: ${BRL.format(c.valor)} pago, ${BRL.format(esp)} para ${s.meses.size} ${s.meses.size > 1 ? 'meses' : 'mês'}.` }); }
    if (c.data && c.data < new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10)) out.push({ t: `Comprovante antigo: pagamento de ${dataBR(c.data)}.` });
  }
  return out;
}
function decideHtml(c) {
  const s = selDe(c), a = S.alunos.get(+s.alunoId);
  const opts = ativos().map(x => `<option value="${x.id}" ${x.id === +s.alunoId ? 'selected' : ''}>${esc(x.nome)}${x.responsavel ? ' · resp. ' + esc(x.responsavel) : ''}</option>`).join('');
  const ms = a ? meses().map(m => { const pago = S.pag.has(`${a.id}|${m}`); return `<label class="mchk"><input type="checkbox" data-act="mes" data-id="${c.id}" value="${m}" ${s.meses.has(m) && !pago ? 'checked' : ''} ${pago ? 'disabled' : ''}>${lblMes(m)}/${m.slice(2, 4)}${pago ? ' ✓' : ''}</label>`; }).join('') : '<span class="muted">Escolha o aluno para ver os meses.</span>';
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
  if (S.alF === 'aberto') al = al.filter(a => a.ativo && statusMes(a, m) !== 'pago');
  if (S.alF === 'devendo') al = al.filter(a => a.ativo && atrasados(a).length);
  const tb = $('#alunos');
  if (!S.e.alunos.length) { tb.innerHTML = `<tr><td colspan="6"><div class="empty">Nenhum aluno cadastrado. Use <b>Novo aluno</b> ou <b>Importar lista</b> para colar a lista da planilha.</div></td></tr>`; return; }
  if (!al.length) { tb.innerHTML = `<tr><td colspan="6" class="muted">Nenhum aluno neste filtro.</td></tr>`; return; }
  const ms = meses().filter(k => k <= S.e.mesAtual).slice(-6);
  tb.innerHTML = al.map(a => {
    const div = atrasados(a).length * a.valor;
    const cells = ms.map(k => { const st = statusMes(a, k); return `<button class="mcell st-${st} ${k === m ? 'sel' : ''}" data-act="mes" data-id="${a.id}" data-m="${k}" title="${esc(lblMesLongo(k))}: ${ST_LBL[st]}">${lblMes(k)}</button>`; }).join('');
    return `<tr${a.ativo ? '' : ' style="opacity:.55"'}><td><div class="nm">${esc(a.nome)}${a.ativo ? '' : ' <span class="pill st-futuro">inativo</span>'}</div><div class="sub">${a.responsavel ? 'Resp.: ' + esc(a.responsavel) + ' · ' : ''}${esc(a.telefone)}</div></td>
      <td>${esc(a.turma)}</td><td class="right num">${BRL.format(a.valor)}</td><td><div class="mstrip">${cells}</div></td>
      <td class="right num">${div ? `<span class="debt">${BRL.format(div)}</span>` : '<span class="muted">—</span>'}</td>
      <td><div class="acts"><button class="btn sm" data-act="editar" data-id="${a.id}">Editar</button>${a.ativo && emAberto(a).length ? `<button class="btn sm" data-act="cobrar" data-id="${a.id}">Cobrar</button>` : ''}</div></td></tr>`;
  }).join('');
}
$('#alFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; S.alF = b.dataset.f; document.querySelectorAll('#alFilter .chip').forEach(x => x.setAttribute('aria-pressed', x === b)); renderAlunos(); });
$('#busca').addEventListener('input', e => { S.busca = e.target.value; renderAlunos(); });
$('#alunos').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return; const a = S.alunos.get(+b.dataset.id); if (!a) return;
  if (b.dataset.act === 'editar') modalAluno(a);
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
    ${a ? `<label class="check"><input type="checkbox" name="ativo" ${a.ativo ? 'checked' : ''}> Aluno ativo</label>` : ''}
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
function modalBaixa(a, m) {
  const opts = meses().filter(k => !S.pag.has(`${a.id}|${k}`)).map(k => `<option value="${k}" ${k === m ? 'selected' : ''}>${lblMesLongo(k)}</option>`).join('');
  const ov = modal(`<h3>Dar baixa · ${esc(a.nome)}</h3><form class="form" id="fBaixa">
    <label>Mês de referência<select name="competencia">${opts}</select></label>
    <div class="row"><label>Valor pago<input name="valor" inputmode="decimal" value="${String(a.valor).replace('.', ',')}"></label>
    <label>Forma de pagamento<select name="via"><option>Dinheiro</option><option>Pix</option><option>Cartão</option><option>Boleto</option></select></label></div>
    <label>Data do pagamento<input name="data" type="date" value="${S.e.hoje}"></label>
    <div class="modal-actions"><button type="button" class="btn" data-x>Cancelar</button><button class="btn primary">Registrar pagamento</button></div></form>`);
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
  const ab = emAberto(a), total = ab.length * a.valor;
  const vars = { responsavel: (a.responsavel || '').split(' ')[0] || 'tudo bem', aluno: a.nome, meses: ab.map(lblMesLongo).join(', '), total: BRL.format(total), escola: S.e.config.escola };
  const msg = S.e.config.texto_cobranca.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  const tel = String(a.telefone).replace(/\D/g, '');
  const podeEnviar = S.wa === 'open' && tel.length >= 10;
  const ov = modal(`<h3>Cobrar ${esc(a.responsavel || a.nome)}</h3><div class="form">
    <label>Mensagem<textarea id="cMsg">${esc(msg)}</textarea></label>
    <div class="hint">WhatsApp: <span class="mono">${esc(a.telefone || 'sem telefone cadastrado')}</span></div></div>
    <div class="modal-actions"><button class="btn" data-x>Fechar</button><button class="btn" id="cCopy">Copiar</button>
    ${podeEnviar ? '<button class="btn primary" id="cEnviar">Enviar pelo WhatsApp da escola</button>' : `<a class="btn primary" target="_blank" rel="noopener" id="cWa" href="#">Abrir no WhatsApp</a>`}</div>`);
  const t = ov.querySelector('#cMsg');
  const link = ov.querySelector('#cWa'); const upd = () => link && (link.href = `https://wa.me/55${tel}?text=${encodeURIComponent(t.value)}`); upd(); t.addEventListener('input', upd);
  ov.querySelector('#cCopy').addEventListener('click', () => navigator.clipboard.writeText(t.value).then(() => toast('Mensagem copiada.'), () => { t.select(); toast('Selecionei o texto. Copie com Ctrl+C.'); }));
  ov.querySelector('#cEnviar')?.addEventListener('click', async e => { e.target.disabled = true; try { await api('POST', '/api/whatsapp/enviar', { telefone: tel, texto: t.value }); fechar(); toast('Mensagem enviada.'); } catch (err) { toast(err.message); e.target.disabled = false; } });
}

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
  if (st === 'nao-configurado' || st === 'fora-do-ar') { card.innerHTML = `<h2>Conexão</h2><p class="warn bad">${st === 'nao-configurado' ? 'A Evolution API não está configurada no servidor (.env).' : 'O serviço do WhatsApp (Evolution API) não respondeu. Veja o guia de instalação, seção "Problemas comuns".'}</p>`; return; }
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
  f.escola.value = c.escola; f.vencimento.value = c.vencimento; f.mes_inicial.value = c.mes_inicial;
  f.resposta_recebido.checked = c.resposta_recebido === '1'; f.resposta_confirmado.checked = c.resposta_confirmado === '1';
  f.texto_recebido.value = c.texto_recebido; f.texto_confirmado.value = c.texto_confirmado; f.texto_cobranca.value = c.texto_cobranca;
}
$('#fAjustes').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  const d = { escola: f.escola.value, vencimento: f.vencimento.value, mes_inicial: f.mes_inicial.value, resposta_recebido: f.resposta_recebido.checked ? '1' : '0', resposta_confirmado: f.resposta_confirmado.checked ? '1' : '0', texto_recebido: f.texto_recebido.value, texto_confirmado: f.texto_confirmado.value, texto_cobranca: f.texto_cobranca.value };
  try { await api('PUT', '/api/config', d); toast('Ajustes salvos.'); await carregar(); } catch (err) { toast(err.message); }
});
$('#sair').addEventListener('click', async () => { await api('POST', '/api/sair').catch(() => {}); location.replace('/entrar'); });

/* ---------- avisos ---------- */
function toast(t, cls = '') { const el = document.createElement('div'); el.className = 'toast ' + cls; el.textContent = t; $('#toasts').append(el); setTimeout(() => el.remove(), 5000); }
let audio; document.addEventListener('pointerdown', () => { try { audio ||= new AudioContext(); } catch {} }, { once: true });
function plim() { if (!audio) return; try { const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(.15, audio.currentTime); g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + .5); o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + .5); } catch {} }
const notice = t => { const n = $('#notice'); n.hidden = !t; n.textContent = t || ''; };

function renderAll() { renderMonths(); renderKpis(); renderComps(); renderAlunos(); }

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
