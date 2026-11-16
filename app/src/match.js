// Sugere a qual aluno um comprovante pertence e quais meses ele quita.
// Sinais, do mais forte para o mais fraco:
//   1. número de WhatsApp de quem mandou = telefone cadastrado do responsável
//   2. nome do pagador parecido com o do responsável ou do aluno
//   3. valor compatível com a mensalidade (1, 2, 3... meses)

export function normalizarTelefone(t) {
  let d = String(t || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return d; // sem DDD: devolve o que tem
  // chave = DDD + últimos 8 dígitos (ignora o "9" extra que às vezes some no WhatsApp)
  return d.slice(0, 2) + d.slice(-8);
}

const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const PARTICULAS = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
const tokens = s => semAcento(s).split(/[^a-z]+/).filter(w => w.length > 1 && !PARTICULAS.has(w));

export function similaridadeNome(a, b) {
  const A = tokens(a), B = new Set(tokens(b));
  if (!A.length || !B.size) return 0;
  let iguais = 0;
  for (const w of A) if (B.has(w)) iguais++;
  // primeiro nome igual pesa mais
  const bonus = A[0] && tokens(b)[0] === A[0] ? 0.25 : 0;
  return Math.min(1, iguais / Math.min(A.length, B.size) * 0.75 + bonus);
}

/**
 * @param {object} c       comprovante: { telefone, valor, pagador }
 * @param {object[]} alunos [{ id, nome, responsavel, telefone, telefone2, valor, ativo }]
 * @param {(alunoId:number)=>string[]} mesesEmAberto  competências em aberto do aluno, mais antiga primeiro
 */
export function sugerirAluno(c, alunos, mesesEmAberto) {
  const tel = normalizarTelefone(c.telefone);
  const cand = alunos.filter(a => a.ativo !== 0).map(a => {
    const motivos = [];
    let pts = 0;
    const telefones = [a.telefone, a.telefone2].map(normalizarTelefone).filter(Boolean);
    if (tel && tel.length >= 10 && telefones.includes(tel)) { pts += 50; motivos.push('enviado do telefone cadastrado'); }
    const simResp = similaridadeNome(c.pagador, a.responsavel);
    const simAluno = similaridadeNome(c.pagador, a.nome);
    const sim = Math.max(simResp, simAluno);
    if (sim >= 0.7) { pts += 30; motivos.push(simResp >= simAluno ? 'pagador é o responsável' : 'pagador tem o nome do aluno'); }
    else if (sim >= 0.35) { pts += 12; motivos.push('pagador com sobrenome parecido'); }
    const abertos = mesesEmAberto(a.id);
    let meses = [];
    if (c.valor && a.valor) {
      const n = c.valor / a.valor;
      const inteiro = Math.round(n);
      if (inteiro >= 1 && Math.abs(n - inteiro) < 0.011) {
        pts += 20; motivos.push(inteiro === 1 ? 'valor igual à mensalidade' : `valor de ${inteiro} mensalidades`);
        meses = abertos.slice(0, inteiro);
      } else {
        meses = abertos.slice(0, 1);
      }
    } else meses = abertos.slice(0, 1);
    if (!abertos.length) pts -= 15; // aluno já está em dia: menos provável
    return { aluno: a, pts, motivos, meses };
  }).filter(x => x.pts > 0).sort((x, y) => y.pts - x.pts);

  if (!cand.length) return { alunoId: null, meses: [], confianca: 'baixa', motivo: 'Não achei aluno pelo telefone, nome ou valor. Escolha manualmente.' };
  const [melhor, segundo] = cand;
  // se dois alunos empatam (irmãos com o mesmo responsável), não decidimos sozinhos
  const empate = segundo && segundo.pts === melhor.pts;
  let confianca = melhor.pts >= 70 ? 'alta' : melhor.pts >= 45 ? 'media' : 'baixa';
  if (empate) confianca = 'baixa';
  let motivo = `${melhor.aluno.nome}: ${melhor.motivos.join(', ')}.`;
  if (empate) motivo += ` Atenção: ${segundo.aluno.nome} tem os mesmos sinais (irmãos?). Confira.`;
  return { alunoId: melhor.aluno.id, meses: melhor.meses, confianca, motivo };
}
