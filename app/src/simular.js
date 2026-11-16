// Simula um comprovante chegando pelo WhatsApp, sem precisar de celular.
// Uso (no servidor):  docker compose exec app node src/simular.js <imagem-ou-pdf> [telefone] [nome]
// Exemplo:            docker compose exec app node src/simular.js /app/exemplos/comprovante-exemplo.png 5511978576408 Eduardo
import { readFile } from 'node:fs/promises';
const [arquivo, telefone = '5511999999999', nome = 'Teste'] = process.argv.slice(2);
if (!arquivo) { console.error('Uso: node src/simular.js <imagem-ou-pdf> [telefone] [nome]'); process.exit(1); }
const mime = arquivo.endsWith('.pdf') ? 'application/pdf' : arquivo.endsWith('.png') ? 'image/png' : 'image/jpeg';
const base64 = (await readFile(arquivo)).toString('base64');
const message = mime === 'application/pdf' ? { documentMessage: { mimetype: mime, fileName: 'comprovante.pdf' }, base64 } : { imageMessage: { mimetype: mime }, base64 };
const r = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/webhook/evolution/${process.env.WEBHOOK_SECRET}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ event: 'messages.upsert', instance: 'escola', data: { key: { remoteJid: `${telefone}@s.whatsapp.net`, fromMe: false, id: 'SIMULADO-' + Date.now() }, pushName: nome, message } }),
});
console.log(r.ok ? 'Comprovante simulado enviado. Veja a aba Comprovantes do painel.' : `Falhou: ${r.status} ${await r.text()}`);
