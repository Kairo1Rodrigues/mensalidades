// Extrai os dados de um comprovante Pix a partir do texto (OCR ou PDF).
// Os comprovantes de bancos diferentes variam muito; aqui usamos sinais
// que quase todos têm: "R$", uma data, o ID da transação (E + 32 caracteres)
// e um bloco "Origem / De / Pagador" com o nome de quem pagou.

const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };

export function normalizarTexto(t) {
  return String(t || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ /g, ' ');
}

export function parseValor(s) {
  // "1.100,00" -> 1100 ; "480,00" -> 480 ; "480.00" -> 480
  let v = String(s).replace(/\s/g, '');
  if (/,\d{2}$/.test(v)) v = v.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{2}$/.test(v) && (v.match(/\./g) || []).length === 1) { /* já está em formato 480.00 */ }
  else v = v.replace(/[.,]/g, '');
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function acharValor(linhas, texto) {
  // 1) valor na mesma linha ou na linha logo depois de "Valor"
  for (let i = 0; i < linhas.length; i++) {
    if (/\bvalor\b/i.test(linhas[i]) && !/tarifa|saldo|limite/i.test(linhas[i])) {
      for (const l of [linhas[i], linhas[i + 1] || '']) {
        const m = l.match(/R\s?\$\s*([\d.]+,\d{2})/i) || l.match(/\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/);
        if (m) return parseValor(m[1]);
      }
    }
  }
  // 2) primeiro "R$ x,yy" do comprovante (normalmente o valor em destaque)
  const m = texto.match(/R\s?\$\s*([\d.]+,\d{2})/i);
  if (m) return parseValor(m[1]);
  return null;
}

function acharData(texto) {
  let m = texto.match(/(\d{2})\/(\d{2})\/(\d{4})(?:[^\d\n]{0,12}(\d{2}):(\d{2}))?/);
  if (m) return { data: `${m[3]}-${m[2]}-${m[1]}`, hora: m[4] ? `${m[4]}:${m[5]}` : '' };
  // "16 NOV 2026 - 10:42" / "16 de novembro de 2026, às 10:42"
  m = texto.match(/(\d{1,2})\s*(?:de\s+)?(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\.?\s*(?:de\s+)?(\d{4})(?:[^\d\n]{0,12}(\d{2}):(\d{2}))?/i);
  if (m) {
    const mes = MESES[m[2].toLowerCase()];
    return { data: `${m[3]}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}`, hora: m[4] ? `${m[4]}:${m[5]}` : '' };
  }
  return { data: '', hora: '' };
}

function acharId(texto) {
  // ID fim-a-fim do Pix: E + 8 dígitos (ISPB) + AAAAMMDDHHmm + 11 alfanuméricos = 32 caracteres.
  // O OCR às vezes quebra em espaços ou linhas, então procuramos também sem espaços.
  const re = /E\d{8}20\d{10}[A-Za-z0-9]{11}/;
  const m = texto.match(re) || texto.replace(/\s+/g, '').match(re);
  if (m) return m[0];
  const alt = texto.match(/(?:autentica[çc][ãa]o|c[óo]digo da transa[çc][ãa]o|id da transa[çc][ãa]o|n[ºo°]? ?(?:de )?controle)\s*:?\s*\n?\s*([A-Za-z0-9\-]{12,})/i);
  return alt ? alt[1] : '';
}

const ROTULO_NOME = /^(?:nome|pagador|de|quem pagou|origem|remetente|enviado por|titular)\b\s*:?\s*/i;
const PALAVRAS_RUINS = /(cpf|cnpj|institui|banco|ag[êe]ncia|conta|chave|valor|data|tipo|id |autentic|\d{3}\.\d{3})/i;
const ROTULOS = /^(dados|nome|pagador|recebedor|origem|destino|para|de|comprovante|transfer|pix|favorecido)\b/i;

function pareceNome(s, relaxado = false) {
  const t = s.trim();
  if (t.length < 5 || t.length > 70) return false;
  if (ROTULOS.test(t)) return false;
  if (relaxado ? /(cpf|cnpj|chave|valor|data|ag[êe]ncia|conta)/i.test(t) : PALAVRAS_RUINS.test(t)) return false;
  if (/\d/.test(t)) return false;
  return t.split(/\s+/).filter(w => w.length > 1).length >= 2;
}

function acharBloco(linhas, cabecalho) {
  const i = linhas.findIndex(l => cabecalho.test(l));
  return i < 0 ? -1 : i;
}

function nomeNoBloco(linhas, inicio, relaxado = false) {
  for (let j = inicio; j < Math.min(linhas.length, inicio + 6); j++) {
    const l = linhas[j];
    const semRotulo = l.replace(/^(?:origem|de|pagador|quem pagou)\s*:?\s*/i, '').replace(ROTULO_NOME, '');
    if (j > inicio && /^(destino|para|recebedor|favorecido|quem recebeu)\b/i.test(l)) break;
    if (pareceNome(semRotulo, relaxado)) return semRotulo.trim();
  }
  return '';
}

function acharPagador(linhas) {
  const i = acharBloco(linhas, /^(?:dados (?:do|de) )?(origem|pagador|quem pagou|de\b|enviado por|remetente)/i);
  if (i >= 0) { const n = nomeNoBloco(linhas, i); if (n) return n; }
  return '';
}

function acharRecebedor(linhas) {
  const i = acharBloco(linhas, /^(?:dados (?:do|de) )?(destino|para\b|recebedor|favorecido|quem recebeu|destinat)/i);
  if (i >= 0) { const n = nomeNoBloco(linhas, i, true); if (n) return n; }
  return '';
}

function acharBanco(linhas) {
  // a instituição dentro do bloco de origem; senão, a primeira menção a banco
  const i = acharBloco(linhas, /^(?:dados (?:do|de) )?(origem|pagador|quem pagou|de\b)/i);
  const busca = i >= 0 ? linhas.slice(i, i + 8) : linhas;
  for (let k = 0; k < busca.length; k++) {
    const m = busca[k].match(/institui[çc][ãa]o\s*:?\s*(.*)$/i);
    if (!m) continue;
    const v = m[1].trim().length > 2 ? m[1].trim() : (busca[k + 1] || '').trim();
    if (v.length > 2) return v.slice(0, 60);
  }
  const b = linhas.find(l => /\b(banco|bank|cooperativa|caixa|nubank|itaú|itau|bradesco|santander|inter|sicoob|sicredi|picpay|mercado pago)\b/i.test(l));
  return b ? b.trim().slice(0, 60) : '';
}

export function parseComprovante(textoBruto) {
  const texto = normalizarTexto(textoBruto);
  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const valor = acharValor(linhas, texto);
  const { data, hora } = acharData(texto);
  const idTransacao = acharId(texto);
  const pagador = acharPagador(linhas);
  const recebedor = acharRecebedor(linhas);
  const banco = acharBanco(linhas);
  const pareceComprovante = !!valor && (/pix|transfer|comprovante|pagamento|recibo/i.test(texto) || !!idTransacao);
  return { valor, data, hora, idTransacao, pagador, recebedor, banco, pareceComprovante };
}
