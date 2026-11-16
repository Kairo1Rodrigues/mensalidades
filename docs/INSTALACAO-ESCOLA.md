# Guia de instalação no computador da escola (Windows)

Sem cartão, sem conta em serviço pago, sem custo. Tempo estimado: **1 hora** na primeira vez.

## O que você precisa

- Um computador com **Windows 10 ou 11 (64 bits)** que possa **ficar ligado o dia todo**.
  - Memória: **4 GB** no mínimo (8 GB é o ideal).
  - **15 GB** livres no disco.
  - Internet (cabo ou Wi-Fi).
- O **celular da escola**, com o WhatsApp que recebe os comprovantes.

Como fica:

```
WhatsApp do celular da escola ──(aparelho conectado)──► Computador da escola
                                                         (Mensalidades em Dia)
                                                                 ▲
                         celulares e PCs no Wi-Fi da escola ─────┘  http://IP-do-computador
```

---

## Parte 1: instalar o Docker Desktop (uma vez só)

O Docker é o programa que roda o sistema. É gratuito para escolas e organizações pequenas.

1. No computador da escola, acesse **docker.com/products/docker-desktop** e clique em **Download for Windows (AMD64)**.
2. Abra o instalador. Deixe marcada a opção **Use WSL 2** e clique em **OK**.
3. No fim, clique em **Close and restart** (o computador reinicia).
4. Depois de reiniciar, o Docker Desktop abre sozinho:
   - aceite os termos (**Accept**);
   - se pedir para entrar numa conta, clique em **Skip** ou **Continue without signing in**. Não precisa de conta.
5. Clique na engrenagem (**Settings**) › **General** e confira que está marcado **Start Docker Desktop when you sign in to your computer**. Clique em **Apply**.
6. Espere aparecer **Engine running** no canto inferior esquerdo.

> Se aparecer um erro de **WSL** ou de **virtualização**, veja **Problemas comuns** no fim deste guia.

## Parte 2: baixar o sistema

1. Acesse **github.com/Kairo1Rodrigues/mensalidades**.
2. Clique no botão verde **Code** › **Download ZIP**.
3. Abra a pasta Downloads, clique com o botão direito no arquivo `mensalidades-main.zip` › **Extrair tudo** e escolha `C:\`.
   - Vai ficar assim: `C:\mensalidades-main`.

## Parte 3: instalar

1. Abra a pasta `C:\mensalidades-main` e dê **dois cliques em `INSTALAR.bat`**.
2. Se aparecer **"O Windows protegeu o computador"**, clique em **Mais informações** › **Executar assim mesmo**.
3. Na janela preta, **crie a senha do painel** (mínimo 8 caracteres) e aperte Enter. As letras não aparecem enquanto você digita, é normal.
4. Quando o Windows perguntar se permite alterações, clique em **Sim**. Isso libera o painel para os celulares e impede o computador de entrar em suspensão.
5. Espere. Na primeira vez leva de **5 a 15 minutos**, porque ele baixa e monta tudo.
6. No fim, aparece **"Pronto!"** com dois endereços, e o navegador abre o painel.
   - **Neste computador:** `http://localhost`. Um atalho **Mensalidades em Dia** também é criado na área de trabalho.
   - **Nos celulares:** algo como `http://192.168.0.15`. **Anote esse endereço.**

## Parte 4: primeiro acesso

1. Entre com a senha que você criou.
2. **Ajustes**: coloque o nome da escola, o dia do vencimento e o primeiro mês que vocês querem controlar. Clique em **Salvar ajustes**.
3. **Alunos › Importar lista**: copie da planilha atual as colunas *aluno, responsável, telefone, turma, mensalidade* e cole. Um aluno por linha.
   - O **WhatsApp do responsável** é o que mais ajuda o sistema a acertar o aluno sozinho. Se pai e mãe pagam, use o campo "Outro telefone" (botão Editar).
4. **WhatsApp › Gerar QR Code**: no celular da escola, abra o WhatsApp › **Configurações › Aparelhos conectados › Conectar um aparelho** e escaneie o QR Code da tela.

## Parte 5: usar no celular da secretaria

1. Conecte o celular no **mesmo Wi-Fi** da escola.
2. Abra o Chrome e digite o endereço que você anotou (ex.: `http://192.168.0.15`).
3. Toque em **⋮ › Adicionar à tela inicial**. O painel vira um ícone, como um app.

> **O endereço pode mudar** se o roteador der outro número para o computador (por exemplo, depois de faltar luz). Para isso não acontecer, peça para quem cuida da internet da escola **reservar o IP** desse computador no roteador. Se mudar, descubra o novo assim: no computador da escola, rode o `INSTALAR.bat` de novo. Ele não apaga nada e mostra o endereço no fim.

## Parte 6: deixar funcionando sempre

- O computador precisa ficar **ligado**. O instalador já desligou a suspensão, mas **não desligue o computador no fim do dia**.
- Depois de uma **reinicialização** (por exemplo, atualização do Windows), o sistema volta sozinho **quando alguém entrar no Windows**. Se o computador pede senha ao ligar, alguém precisa entrar nele depois de cada reinício.
- Se o computador ficar desligado, **nada se perde**: os comprovantes continuam no WhatsApp do celular. Quando ele voltar, os novos voltam a entrar sozinhos. Os que chegaram com o computador desligado podem ser enviados pelo botão **Enviar comprovante** do painel.

### Testar sem esperar um pagamento

Na pasta `C:\mensalidades-main`, clique na barra de endereço do Explorer, digite `powershell` e aperte Enter. Na janela azul:

```bash
docker compose exec app node src/simular.js /app/exemplos/comprovante-exemplo.png 5511999999999 Teste
```

Em alguns segundos, o comprovante de exemplo aparece na aba **Comprovantes**. Depois, toque em **Rejeitar**.

---

## Dia a dia

- Comprovante chega no WhatsApp → o painel avisa (som + contador) → a secretaria confere a sugestão e toca em **Confirmar baixa**.
- Se estiver ligado em **Ajustes**, o responsável recebe "Recebemos seu comprovante" na hora e "Pagamento confirmado" depois da baixa.
- Pagamento em dinheiro: **Alunos ›** toque no mês › **Registrar pagamento**.
- **Cobrar**: na lista de alunos, o botão monta a mensagem e envia pelo WhatsApp da escola, **uma pessoa por vez**.
- **Baixar planilha** (aba Alunos): gera um arquivo que abre no Excel.

### Cuidados com o WhatsApp

A conexão usa a Evolution API, que **não é oficial** do WhatsApp. Para manter o risco de bloqueio baixo:

- não use o sistema para mandar mensagens em massa;
- mande cobranças uma a uma, só para quem está devendo;
- se o WhatsApp desconectar, gere o QR Code de novo na aba WhatsApp.

## Manutenção (tudo com dois cliques na pasta `C:\mensalidades-main`)

| Para… | Faça |
|---|---|
| Atualizar o sistema | `ATUALIZAR.bat` (os dados e a senha são mantidos) |
| Fazer backup | `BACKUP.bat` → abre a pasta do backup; copie-a para um **pen drive** ou para o **Google Drive**. Faça **uma vez por mês**. |
| Reiniciar o sistema | Feche e abra o Docker Desktop, ou reinicie o computador |
| Trocar a senha do painel | Abra o arquivo `.env` com o Bloco de Notas, troque o que está entre as aspas em `SENHA_PAINEL='...'`, salve e rode o `INSTALAR.bat` |

O sistema também faz **um backup automático por dia** dentro do computador e guarda os últimos 14. O `BACKUP.bat` copia esses backups para fora, para o caso de o computador quebrar.

## Problemas comuns

| Problema | O que fazer |
|---|---|
| Docker Desktop diz que precisa atualizar o **WSL** | Abra o menu Iniciar, procure **PowerShell**, clique com o botão direito › **Executar como administrador** e rode `wsl --update`. Depois reinicie o computador. |
| Erro de **virtualização** (*Virtualization support not detected*) | A virtualização precisa ser ligada na BIOS do computador (opção **Intel VT-x** ou **AMD-V / SVM**). O jeito de entrar na BIOS muda de marca para marca: mande um print do erro e o modelo do computador para quem está ajudando você. |
| Na janela do instalador aparece **"port is already allocated"** (porta 80 ocupada) | Abra o `.env` no Bloco de Notas, troque `PORTA_PAINEL=80` por `PORTA_PAINEL=8080`, salve e rode o `INSTALAR.bat`. Os endereços passam a terminar com `:8080` (ex.: `http://192.168.0.15:8080`). |
| O painel abre no computador mas **não abre no celular** | Confira se o celular está no **mesmo Wi-Fi** (redes de "visitantes" costumam bloquear). Rode o `INSTALAR.bat` de novo e clique em **Sim** quando o Windows pedir permissão. |
| Aba WhatsApp diz que o serviço **não respondeu** | Se o computador acabou de ligar, espere 2 minutos. Se continuar, feche e abra o Docker Desktop. |
| O QR Code não aparece | Toque em **Gerar QR Code** de novo depois de 10 segundos. |
| A leitura de um comprovante veio errada | Toque em **Ver texto lido**, escolha o aluno e os meses manualmente e confirme. Prints nítidos funcionam melhor que fotos da tela. |
| Esqueci a senha | Veja "Trocar a senha do painel" em Manutenção. |
| Qualquer outra coisa | Tire um print da tela (ou da janela preta) e envie para quem está ajudando você. |

---

Quer o sistema acessível fora da escola, ou não tem computador para deixar ligado? Veja a [instalação num servidor na internet](INSTALACAO-INTERNET.md), que exige cartão no cadastro da Oracle. Se o computador da escola usa **Linux**, rode `./scripts/instalar.sh` e escolha a opção `1`.
