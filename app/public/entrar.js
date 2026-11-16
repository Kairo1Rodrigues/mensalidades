const f = document.getElementById('f'), erro = document.getElementById('erro');
f.addEventListener('submit', async e => {
  e.preventDefault(); erro.textContent = '';
  const b = f.querySelector('button'); b.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senha: document.getElementById('senha').value }) });
    if (r.ok) return location.replace('/');
    erro.textContent = (await r.json().catch(() => ({}))).erro || 'Não consegui entrar.';
  } catch { erro.textContent = 'Sem conexão com o servidor.'; }
  b.disabled = false;
});
