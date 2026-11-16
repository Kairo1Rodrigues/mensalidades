// Transforma a imagem ou o PDF do comprovante em texto, sem custo:
// - PDF com texto (a maioria dos PDFs de banco): pdftotext
// - imagem, ou PDF escaneado: Tesseract OCR em português
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);
const LIMITE = { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 };

async function tesseract(arquivo) {
  // psm 4: coluna única de texto de tamanho variável, que é como um print de celular é.
  const { stdout } = await run('tesseract', [arquivo, 'stdout', '-l', 'por', '--psm', '4'], LIMITE);
  return stdout;
}

export async function extrairTexto(arquivo, mime) {
  if (mime === 'application/pdf' || arquivo.endsWith('.pdf')) {
    try {
      const { stdout } = await run('pdftotext', ['-layout', '-l', '2', arquivo, '-'], LIMITE);
      if (stdout.replace(/\s/g, '').length > 40) return stdout.replace(/ {2,}/g, '\n');
    } catch { /* cai para o OCR */ }
    const dir = await mkdtemp(path.join(tmpdir(), 'pdf-'));
    try {
      await run('pdftoppm', ['-png', '-r', '200', '-f', '1', '-l', '1', arquivo, path.join(dir, 'p')], LIMITE);
      const [png] = (await readdir(dir)).filter(f => f.endsWith('.png'));
      return png ? await tesseract(path.join(dir, png)) : '';
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  return tesseract(arquivo);
}
