// Cliente mínimo da Evolution API (v2), que mantém o WhatsApp da escola conectado.
// Documentação: https://doc.evolution-api.com

export function criarEvolution({ url, apiKey, instancia, webhookUrl }) {
  const chamar = async (metodo, caminho, corpo) => {
    const r = await fetch(url.replace(/\/$/, '') + caminho, {
      method: metodo,
      headers: { apikey: apiKey, 'content-type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const texto = await r.text();
    let json; try { json = JSON.parse(texto); } catch { json = { texto }; }
    if (!r.ok) { const e = new Error(`Evolution API ${r.status}: ${texto.slice(0, 300)}`); e.status = r.status; e.resposta = json; throw e; }
    return json;
  };

  return {
    configurada: !!(url && apiKey),

    async estado() {
      try {
        const r = await chamar('GET', `/instance/connectionState/${instancia}`);
        return r?.instance?.state || r?.state || 'desconhecido'; // open | connecting | close
      } catch (e) {
        if (e.status === 404) return 'inexistente';
        throw e;
      }
    },

    async garantirInstancia() {
      if ((await this.estado()) === 'inexistente') {
        await chamar('POST', '/instance/create', { instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true });
      }
      await chamar('POST', `/webhook/set/${instancia}`, {
        webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] },
      });
    },

    /**
     * Devolve o QR Code (data URL) para escanear com o celular da escola.
     * Cuidado: na Evolution, /instance/connect com o estado "close" abre uma conexão NOVA sem fechar
     * a anterior. Chamado várias vezes (ou enquanto a Evolution já reconecta sozinha, como logo depois
     * de escanear o QR), deixa duas conexões da mesma sessão se derrubando sem parar
     * ("conflict: replaced"). Por isso pedimos a conexão no máximo uma vez e, depois, só lemos o QR
     * enquanto o estado é "connecting" (aí /instance/connect apenas devolve o QR atual).
     * Com renovar = true (atualização automática da tela), nunca abre conexão nova.
     */
    async conectar({ renovar = false } = {}) {
      const espera = ms => new Promise(ok => setTimeout(ok, ms));
      const lerQr = async () => {
        const r = await chamar('GET', `/instance/connect/${instancia}`);
        return { qr: r?.base64 || r?.qrcode?.base64 || null, codigo: r?.pairingCode || r?.qrcode?.pairingCode || null };
      };
      if (!renovar) await this.garantirInstancia();
      let estado = await this.estado();
      if (estado === 'open') return { qr: null, codigo: null, estado };
      if (estado !== 'connecting') {
        if (renovar) return { qr: null, codigo: null, estado };
        await espera(3000); // pode ser a Evolution reconectando sozinha: dá tempo antes de decidir
        estado = await this.estado();
        if (estado === 'open') return { qr: null, codigo: null, estado };
        if (estado !== 'connecting') { await lerQr(); estado = 'connecting'; } // única chamada que abre conexão
      }
      // logo depois de conectar, a Evolution leva alguns segundos para gerar o QR ({count: 0})
      for (let i = 0; i < 12; i++) {
        estado = await this.estado();
        if (estado === 'open') return { qr: null, codigo: null, estado };
        if (estado === 'connecting') { const q = await lerQr(); if (q.qr) return { ...q, estado }; }
        await espera(1500);
      }
      return { qr: null, codigo: null, estado: await this.estado() };
    },

    async desconectar() { return chamar('DELETE', `/instance/logout/${instancia}`); },

    /** Baixa a mídia de uma mensagem quando o webhook não trouxe o base64. */
    async midia(mensagem) {
      const r = await chamar('POST', `/chat/getBase64FromMediaMessage/${instancia}`, { message: { key: mensagem.key, message: mensagem.message }, convertToMp4: false });
      return { base64: r?.base64, mime: r?.mimetype };
    },

    /** Mensagens guardadas pela Evolution num período (mais novas primeiro), uma página por vez. */
    async buscarMensagens({ desde, ate, pagina = 1, porPagina = 100 }) {
      const r = await chamar('POST', `/chat/findMessages/${instancia}`, {
        where: { messageTimestamp: { gte: desde.toISOString(), lte: ate.toISOString() } }, page: pagina, offset: porPagina,
      });
      const m = r?.messages ?? r;
      const registros = Array.isArray(m) ? m : (m?.records || []);
      return { registros, paginas: Number(m?.pages) || 1 };
    },

    async enviarTexto(numero, texto) {
      return chamar('POST', `/message/sendText/${instancia}`, { number: numero, text: texto });
    },
  };
}

/** Número de quem mandou a mensagem. O WhatsApp às vezes usa "@lid" (id oculto) no lugar do número. */
export function numeroDoRemetente(data) {
  const k = data?.key || {};
  const candidatos = [k.remoteJid, k.remoteJidAlt, k.senderPn, data?.senderPn, k.participantAlt];
  for (const j of candidatos) if (j && /@s\.whatsapp\.net$/.test(j)) return j.split('@')[0];
  return '';
}

/** Para responder: usa o jid original (funciona também com @lid). */
export const destinoResposta = data => numeroDoRemetente(data) || data?.key?.remoteJid || '';

export function midiaDaMensagem(data) {
  const m = data?.message || {};
  const img = m.imageMessage || m.viewOnceMessageV2?.message?.imageMessage;
  if (img) return { tipo: 'imagem', mime: img.mimetype || 'image/jpeg', legenda: img.caption || '' };
  const doc = m.documentMessage || m.documentWithCaptionMessage?.message?.documentMessage;
  if (doc && /pdf|image\//.test(doc.mimetype || '')) return { tipo: 'documento', mime: doc.mimetype, legenda: doc.caption || doc.fileName || '' };
  return null;
}
