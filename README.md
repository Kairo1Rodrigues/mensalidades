# Mensalidades em Dia

Controle de mensalidades para escolas pequenas. Os comprovantes Pix que os responsáveis mandam no WhatsApp da escola chegam sozinhos no painel, o sistema lê o comprovante e sugere o aluno e o mês, e a secretaria confirma a baixa com um toque.

Custo de software e hospedagem: **zero**. Roda na Oracle Cloud (camada gratuita), com OCR gratuito (Tesseract) e a Evolution API (código aberto) para o WhatsApp.

**Para instalar, siga [docs/INSTALACAO.md](docs/INSTALACAO.md).**

## O que tem aqui

| Pasta | O que é |
|---|---|
| `app/` | O sistema: servidor Node.js sem dependências externas, painel web e leitura dos comprovantes |
| `app/src/parse.js` | Extrai valor, data, pagador, banco e ID da transação do texto do comprovante |
| `app/src/match.js` | Sugere o aluno pelo telefone de quem mandou, pelo nome do pagador e pelo valor |
| `app/src/evolution.js` | Ligação com a Evolution API (WhatsApp) |
| `docker-compose.yml` | Sobe o sistema, a Evolution API, o banco dela e o HTTPS (Caddy) |
| `scripts/` | Instalar, atualizar e fazer backup |
| `prototipo/` | O protótipo da apresentação (página única, dados fictícios) |

## Desenvolvimento

Requer Node.js 22.13 ou mais novo, `tesseract-ocr`, `tesseract-ocr-por` e `poppler-utils`.

```bash
cd app && npm test
```

```bash
cd app && SENHA_PAINEL=senha-local-123 COOKIE_SECURE=0 node src/server.js
```

Sem `EVOLUTION_URL`, o painel funciona normalmente e os comprovantes entram pelo botão **Enviar comprovante**.
