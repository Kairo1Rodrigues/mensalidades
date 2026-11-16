import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseComprovante, parseValor } from '../src/parse.js';
import { sugerirAluno, normalizarTelefone, similaridadeNome } from '../src/match.js';

// Textos no estilo de comprovantes Pix de bancos diferentes (dados fictícios).
const LAYOUT_A = `Comprovante de transferência
16 NOV 2026 - 10:42:11
Valor
R$ 480,00
Tipo de transferência
Pix
Destino
Nome
INSTITUICAO DE ENSINO EXEMPLO
CNPJ
00.000.000/0001-00
Instituição
BANCO DA ESCOLA S.A.
Origem
Nome
Priscila Oliveira Almeida
Instituição
BANCO HORIZONTE S.A.
CPF
•••.482.913-••
ID da transação:
E18236120202611161042s04a7KQ2XbR`;

const LAYOUT_B = `Pix enviado
R$ 1.100,00
16/11/2026 às 07:34
Para
INSTITUICAO DE ENSINO EXEMPLO LTDA
Chave Pix financeiro@escola.exemplo
De
JULIANA CARDOSO ALMEIDA
Instituição Cooperativa Vale Sul
Código de autenticação
E00416968 202611160734kLp93TzWq1M`;

const LAYOUT_C = `COMPROVANTE DE PAGAMENTO PIX
Data do pagamento: 15/11/2026 19:12
Valor: 550,00
Dados do pagador
Nome: JOSE CARLOS MOREIRA
CPF: ***.123.456-**
Dados do recebedor
Nome: INSTITUICAO DE ENSINO EXEMPLO`;

test('layout A (bloco Origem/Destino, data por extenso)', () => {
  const r = parseComprovante(LAYOUT_A);
  assert.equal(r.valor, 480);
  assert.equal(r.data, '2026-11-16');
  assert.equal(r.hora, '10:42');
  assert.equal(r.pagador, 'Priscila Oliveira Almeida');
  assert.equal(r.recebedor, 'INSTITUICAO DE ENSINO EXEMPLO');
  assert.equal(r.idTransacao, 'E18236120202611161042s04a7KQ2XbR');
  assert.match(r.banco, /HORIZONTE/);
  assert.ok(r.pareceComprovante);
});

test('layout B (De/Para, ID quebrado por espaço, milhar)', () => {
  const r = parseComprovante(LAYOUT_B);
  assert.equal(r.valor, 1100);
  assert.equal(r.data, '2026-11-16');
  assert.equal(r.pagador, 'JULIANA CARDOSO ALMEIDA');
  assert.equal(r.idTransacao, 'E00416968202611160734kLp93TzWq1M');
  assert.match(r.banco, /Vale Sul/);
});

test('layout C (rótulos "Nome:" e "Valor:" sem R$)', () => {
  const r = parseComprovante(LAYOUT_C);
  assert.equal(r.valor, 550);
  assert.equal(r.data, '2026-11-15');
  assert.equal(r.pagador, 'JOSE CARLOS MOREIRA');
});

test('foto que não é comprovante', () => {
  const r = parseComprovante('Bom dia! Segue a foto da reunião de pais.');
  assert.equal(r.valor, null);
  assert.equal(r.pareceComprovante, false);
});

test('parseValor', () => {
  assert.equal(parseValor('1.100,00'), 1100);
  assert.equal(parseValor('480,00'), 480);
  assert.equal(parseValor('432.00'), 432);
});

test('telefone com e sem o nono dígito e com 55', () => {
  assert.equal(normalizarTelefone('(11) 94288-4096'), normalizarTelefone('5511942884096'));
  assert.equal(normalizarTelefone('551142884096'), normalizarTelefone('(11) 94288-4096'));
});

test('similaridade de nomes ignora acento e caixa', () => {
  assert.ok(similaridadeNome('PRISCILA OLIVEIRA ALMEIDA', 'Priscila Oliveira Almeida') >= 0.9);
  assert.ok(similaridadeNome('JOSE CARLOS MOREIRA', 'Eduardo Souza Moreira') < 0.7);
});

const ALUNOS = [
  { id: 1, nome: 'Heitor Almeida', responsavel: 'Priscila Oliveira Almeida', telefone: '(11) 94288-4096', valor: 480 },
  { id: 2, nome: 'Davi Almeida', responsavel: 'Juliana Cardoso Almeida', telefone: '(11) 92979-6690', valor: 550 },
  { id: 3, nome: 'Lara Moreira', responsavel: 'Eduardo Souza Moreira', telefone: '(11) 97857-6408', valor: 550 },
  { id: 4, nome: 'Alice Moreira', responsavel: 'Eduardo Souza Moreira', telefone: '(11) 97857-6408', valor: 550 },
];
const abertos = { 1: ['2026-11'], 2: ['2026-10', '2026-11'], 3: ['2026-10', '2026-11'], 4: ['2026-11'] };
const emAberto = id => abertos[id];

test('casa pelo telefone + nome + valor com confiança alta', () => {
  const s = sugerirAluno({ telefone: '5511942884096', valor: 480, pagador: 'PRISCILA OLIVEIRA ALMEIDA' }, ALUNOS, emAberto);
  assert.equal(s.alunoId, 1);
  assert.equal(s.confianca, 'alta');
  assert.deepEqual(s.meses, ['2026-11']);
});

test('valor de duas mensalidades sugere os dois meses mais antigos', () => {
  const s = sugerirAluno({ telefone: '551192979-6690', valor: 1100, pagador: 'JULIANA CARDOSO ALMEIDA' }, ALUNOS, emAberto);
  assert.equal(s.alunoId, 2);
  assert.deepEqual(s.meses, ['2026-10', '2026-11']);
});

test('irmãos com o mesmo responsável: não decide sozinho', () => {
  const s = sugerirAluno({ telefone: '5511978576408', valor: 550, pagador: 'EDUARDO SOUZA MOREIRA' }, ALUNOS, emAberto);
  assert.equal(s.confianca, 'baixa');
  assert.match(s.motivo, /irmãos/);
});

test('ninguém bate', () => {
  const s = sugerirAluno({ telefone: '5521900000000', valor: 37.5, pagador: 'FULANO DESCONHECIDO' }, ALUNOS, emAberto);
  assert.equal(s.alunoId, null);
});
