# Guia de instalação num servidor na internet (Oracle Cloud)

> Este caminho exige **cartão de crédito** no cadastro da Oracle. Para instalar num computador da escola, sem cartão, use o [guia do computador da escola](INSTALACAO-ESCOLA.md).

Tempo estimado: **1 hora**, na primeira vez. Você vai precisar de:

- um computador com internet;
- um **cartão de crédito** (a Oracle pede só para verificar a identidade; nada é cobrado enquanto você usar os recursos "Always Free");
- o **celular da escola** com o WhatsApp que recebe os comprovantes, para escanear o QR Code no final.

O que vai ficar funcionando no fim:

```
WhatsApp da escola ──(aparelho conectado)──► Evolution API ─┐
                                                            ▼
              navegador (celular ou PC) ◄── HTTPS ── Painel Mensalidades em Dia
                                                    (lê o comprovante e sugere o aluno)
```

---

## Parte 1: criar a conta na Oracle Cloud

1. Acesse **cloud.oracle.com** e clique em **Sign up** (Cadastre-se).
2. Preencha os dados. Em **Home Region** (região principal), escolha **Brazil East (Sao Paulo)**. Essa escolha não pode ser trocada depois.
3. Informe o cartão para verificação e conclua o cadastro. A conta pode levar alguns minutos para ser ativada.

> **Importante: evite que a Oracle desligue a máquina.** Em contas gratuitas, a Oracle pode recolher máquinas que ficam "paradas" (pouco uso de processador por 7 dias), e este sistema usa pouco processador. Para evitar isso, depois de criar a conta, vá em **Billing › Upgrade and Manage Payment** e passe a conta para **Pay As You Go**. Você **continua sem pagar nada** enquanto usar só os recursos "Always Free", e a máquina deixa de ser recolhida. Para ficar tranquilo, crie um alerta de gastos em **Billing › Budgets** com valor de R$ 1.

## Parte 2: criar a máquina (servidor)

1. No menu, vá em **Compute › Instances › Create instance**.
2. **Name**: `mensalidades`.
3. **Image**: clique em *Change image* e escolha **Canonical Ubuntu 24.04**.
4. **Shape**: clique em *Change shape* › **Ampere** › **VM.Standard.A1.Flex**, com **2 OCPUs** e **12 GB** de memória (está dentro do gratuito).
   - Se aparecer **"Out of capacity"**, tente outro *Availability domain* ou outro horário. Se não conseguir de jeito nenhum, use **VM.Standard.E2.1.Micro** (AMD, também gratuita). O script de instalação se ajusta a ela.
5. **Networking**: deixe criar uma rede nova e confira que **Assign a public IPv4 address** está marcado.
6. **Add SSH keys**: escolha **Generate a key pair for me** e clique em **Save private key**. Guarde esse arquivo (`.key`): é a chave para entrar no servidor.
7. Clique em **Create**. Quando ficar **Running**, anote o **Public IP address** (ex.: `150.230.10.20`).

## Parte 3: liberar as portas do site (80 e 443)

1. Na página da máquina, clique no nome da **Virtual cloud network** (em *Primary VNIC*).
2. Vá em **Security Lists › Default Security List › Add Ingress Rules**.
3. Adicione esta regra:
   - Source CIDR: `0.0.0.0/0`
   - IP Protocol: `TCP`
   - Destination Port Range: `80`
4. Repita com a porta `443`.

## Parte 4: criar o endereço do painel (DuckDNS, grátis)

1. Acesse **duckdns.org** e entre com uma conta Google ou GitHub.
2. Em *sub domain*, digite um nome (ex.: `teologiasaojoao`) e clique em **add domain**. O endereço vai ser `teologiasaojoao.duckdns.org`.
3. No campo **current ip**, coloque o **IP público** da máquina (Parte 2) e clique em **update ip**.
4. Copie o **token** que aparece no topo da página. O script usa esse token para manter o endereço atualizado.

## Parte 5: instalar o sistema

### 5.1 Entrar no servidor

**No Windows** (10 ou 11), abra o **PowerShell** e digite, trocando o caminho da chave e o IP:

```bash
ssh -i C:\Users\SEU_USUARIO\Downloads\ssh-key.key ubuntu@150.230.10.20
```

**No Mac ou Linux**, abra o Terminal:

```bash
chmod 600 ~/Downloads/ssh-key.key
```

```bash
ssh -i ~/Downloads/ssh-key.key ubuntu@150.230.10.20
```

Na primeira vez, ele pergunta se você confia no servidor: digite `yes`.

### 5.2 Baixar o sistema e instalar

Já dentro do servidor, rode um comando de cada vez:

```bash
sudo apt-get update && sudo apt-get install -y git
```

```bash
git clone https://github.com/Kairo1Rodrigues/mensalidades.git
```

```bash
cd mensalidades && ./scripts/instalar.sh
```

O script vai perguntar:

1. **Onde vai rodar**: escolha `2` (servidor na internet);
2. **Endereço do painel**: o do DuckDNS (ex.: `teologiasaojoao.duckdns.org`);
3. **Token do DuckDNS**: cole o token da Parte 4;
4. **Senha do painel**: a senha que a secretaria vai usar para entrar (mínimo 8 caracteres).

Na primeira vez ele leva uns 5 minutos. No fim, aparece **"Pronto! Acesse: https://…"**.

## Parte 6: primeiro acesso

1. Abra o endereço no navegador e entre com a senha.
2. **Ajustes**: coloque o nome da escola, o dia do vencimento e o primeiro mês que vocês querem controlar.
3. **Alunos › Importar lista**: copie da planilha atual as colunas *aluno, responsável, telefone, turma, mensalidade* e cole. Um aluno por linha.
   - O **telefone do responsável** é o que mais ajuda o sistema a acertar o aluno sozinho. Cadastre o número de WhatsApp de quem costuma pagar. Se pai e mãe pagam, use o campo "Outro telefone".
4. **WhatsApp › Gerar QR Code**: no celular da escola, abra o WhatsApp › **Configurações › Aparelhos conectados › Conectar um aparelho** e escaneie o QR Code.
5. **No celular da secretaria**: abra o endereço no Chrome e toque em **⋮ › Adicionar à tela inicial**. O painel vira um "app".

### Testar sem esperar um pagamento

No servidor:

```bash
cd ~/mensalidades && sudo docker compose exec app node src/simular.js /app/exemplos/comprovante-exemplo.png 5511999999999 Teste
```

O comprovante de exemplo aparece na aba **Comprovantes** em alguns segundos. Depois do teste, toque em **Rejeitar**.

---

## Dia a dia

- Comprovante chega no WhatsApp → o painel avisa (som + contador) → a secretaria confere a sugestão e toca em **Confirmar baixa**.
- Se a escola deixar ligado em **Ajustes**, o responsável recebe "Recebemos seu comprovante" na hora e "Pagamento confirmado" depois da baixa.
- Pagamento em dinheiro: **Alunos ›** toque no mês › **Registrar pagamento**.
- **Cobrar**: na lista de alunos, o botão monta a mensagem e envia pelo WhatsApp da escola, **uma pessoa por vez**.
- **Baixar planilha** (aba Alunos) gera um arquivo que abre no Excel, para imprimir ou levar à reunião.

### Cuidados com o WhatsApp

A conexão é feita pela Evolution API, que **não é oficial** do WhatsApp. Para manter o risco de bloqueio baixo:

- não use o sistema para mandar mensagens em massa;
- mande cobranças uma a uma, só para quem está devendo;
- se o WhatsApp desconectar, gere o QR Code de novo na aba WhatsApp.

Nada se perde: se a conexão cair, os comprovantes continuam no WhatsApp do celular, e dá para enviá-los pelo botão **Enviar comprovante** do painel.

## Manutenção

Os comandos abaixo são rodados no servidor (Parte 5.1), dentro da pasta `mensalidades`:

| Para… | Comando |
|---|---|
| Ver se está tudo rodando | `sudo docker compose ps` |
| Ver o que aconteceu (logs) | `sudo docker compose logs --tail 100 app` |
| Reiniciar | `sudo docker compose restart` |
| Atualizar o sistema | `./scripts/atualizar.sh` |
| Copiar os backups | `./scripts/backup.sh` |
| Trocar a senha do painel | edite `SENHA_PAINEL` com `nano .env`, depois `sudo docker compose up -d` |

**Backups**: o sistema faz uma cópia do banco de dados todo dia e guarda as últimas 14. Uma vez por mês, rode `./scripts/backup.sh` e baixe a pasta para outro computador:

```bash
scp -r -i CAMINHO_DA_CHAVE ubuntu@IP_DO_SERVIDOR:mensalidades/backup-* .
```

## Problemas comuns

| Problema | O que fazer |
|---|---|
| O endereço não abre | Confira se o DuckDNS mostra o IP certo (Parte 4) e se as portas 80 e 443 estão liberadas (Parte 3). Veja `sudo docker compose logs caddy`. |
| "Serviço fora do ar" na aba WhatsApp | `sudo docker compose restart evolution`, espere 1 minuto e tente de novo. |
| O QR Code não aparece | Toque em **Gerar QR Code** de novo depois de 10 segundos. Se continuar, veja `sudo docker compose logs --tail 50 evolution`. |
| Comprovante chegou mas a leitura veio errada | Abra **Ver texto lido** para ver o que foi lido, corrija o aluno e os meses manualmente e confirme. Prints nítidos funcionam melhor que fotos da tela. |
| Esqueci a senha | Edite `SENHA_PAINEL` no arquivo `.env` (veja Manutenção). |
| A Oracle desligou a máquina | Veja o aviso da Parte 1 sobre a conta **Pay As You Go**. Os dados ficam no disco: basta ligar a máquina de novo (**Start**). |
