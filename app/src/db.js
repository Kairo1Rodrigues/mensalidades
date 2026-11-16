// Banco de dados SQLite (um arquivo só, fácil de copiar como backup).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

export function abrirBanco(dir) {
  mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'escola.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);
    CREATE TABLE IF NOT EXISTS alunos (
      id INTEGER PRIMARY KEY,
      nome TEXT NOT NULL,
      responsavel TEXT NOT NULL DEFAULT '',
      telefone TEXT NOT NULL DEFAULT '',
      telefone2 TEXT NOT NULL DEFAULT '',
      turma TEXT NOT NULL DEFAULT '',
      valor REAL NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comprovantes (
      id INTEGER PRIMARY KEY,
      recebido_em INTEGER NOT NULL,
      origem TEXT NOT NULL,              -- whatsapp | upload
      msg_id TEXT UNIQUE,                -- id da mensagem no WhatsApp (evita duplicar)
      telefone TEXT NOT NULL DEFAULT '',
      remetente TEXT NOT NULL DEFAULT '',
      responder TEXT NOT NULL DEFAULT '', -- para onde mandar as respostas no WhatsApp
      legenda TEXT NOT NULL DEFAULT '',
      arquivo TEXT,
      mime TEXT,
      status TEXT NOT NULL DEFAULT 'lendo', -- lendo | pendente | aprovado | rejeitado
      texto TEXT,
      valor REAL, data_pag TEXT, hora_pag TEXT, pagador TEXT, banco TEXT, id_transacao TEXT, parece_comprovante INTEGER,
      sugestao_aluno_id INTEGER, sugestao_meses TEXT, confianca TEXT, motivo TEXT,
      aluno_id INTEGER REFERENCES alunos(id) ON DELETE SET NULL,
      competencias TEXT,
      conferido_em INTEGER
    );
    CREATE INDEX IF NOT EXISTS comp_status ON comprovantes(status, recebido_em);
    CREATE TABLE IF NOT EXISTS pagamentos (
      id INTEGER PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      competencia TEXT NOT NULL,         -- AAAA-MM
      valor REAL NOT NULL,
      data TEXT NOT NULL,                -- AAAA-MM-DD
      via TEXT NOT NULL DEFAULT 'Pix',
      comprovante_id INTEGER REFERENCES comprovantes(id) ON DELETE SET NULL,
      criado_em INTEGER NOT NULL,
      UNIQUE (aluno_id, competencia)
    );
    CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, expira INTEGER NOT NULL);
    -- mensalidades provisionadas: um título por aluno por mês, com o valor da época
    CREATE TABLE IF NOT EXISTS mensalidades (
      id INTEGER PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      competencia TEXT NOT NULL,         -- AAAA-MM
      valor REAL NOT NULL,
      UNIQUE (aluno_id, competencia)
    );
    -- histórico de relacionamento (CRM): cobranças, conversas e anotações por aluno
    CREATE TABLE IF NOT EXISTS contatos (
      id INTEGER PRIMARY KEY,
      aluno_id INTEGER NOT NULL REFERENCES alunos(id) ON DELETE CASCADE,
      quando INTEGER NOT NULL,
      tipo TEXT NOT NULL,                -- cobranca | whatsapp | nota
      texto TEXT NOT NULL DEFAULT '',
      promessa TEXT                      -- AAAA-MM-DD: responsável prometeu pagar até
    );
    CREATE INDEX IF NOT EXISTS contatos_aluno ON contatos(aluno_id, quando);
  `);
  // bancos criados antes desta versão: mês a partir do qual o aluno é cobrado
  const colunas = db.prepare('PRAGMA table_info(alunos)').all().map(c => c.name);
  if (!colunas.includes('inicio_cobranca')) db.exec(`ALTER TABLE alunos ADD COLUMN inicio_cobranca TEXT NOT NULL DEFAULT ''`);
  return db;
}

export const PADRAO = {
  escola: 'Nossa escola',
  vencimento: '10',
  mes_inicial: '',            // não usado mais (substituído por provisao_inicio)
  provisao_inicio: '2026-01', // primeiro mês com mensalidade gerada (AAAA-MM)
  provisao_fim: '2027-12',    // último mês com mensalidade gerada (AAAA-MM)
  ultima_varredura: '',       // JSON { em, dias, encontradas, novas, erros } da última busca de comprovantes
  resposta_recebido: '1',
  texto_recebido: 'Recebemos seu comprovante! Vamos conferir e em breve confirmamos por aqui. Obrigado!',
  resposta_confirmado: '1',
  texto_confirmado: 'Pagamento confirmado: mensalidade de {aluno} referente a {meses}. Obrigado!',
  texto_cobranca: 'Olá, {responsavel}! Tudo bem? Aqui é da secretaria da {escola}.\n\nConsta em aberto a mensalidade de {aluno} referente a {meses}, no total de {total}.\n\nSe você já pagou, é só mandar o comprovante por aqui que a gente dá baixa. Obrigado!',
};

export function lerConfig(db) {
  const c = { ...PADRAO };
  for (const r of db.prepare('SELECT chave, valor FROM config').all()) c[r.chave] = r.valor;
  return c;
}

export function salvarConfig(db, valores) {
  const st = db.prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor');
  for (const [k, v] of Object.entries(valores)) if (k in PADRAO) st.run(k, String(v ?? ''));
}
