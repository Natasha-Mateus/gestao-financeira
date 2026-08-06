# Gestão Financeira

App pessoal de gestão financeira para o casal, com 5 módulos: Dashboard, Contas Fixas, Mercado, Cartão de Crédito, Renda e Reservas.

## Configuração necessária antes de usar

### 1. Regras do Firestore
No Firebase Console → Firestore Database → Regras, cole o conteúdo do arquivo `firestore.rules` deste projeto e publique. Isso garante que só quem estiver logado acessa os dados.

### 2. Criar os usuários (você e seu esposo)
No Firebase Console → Authentication → Users → "Add user", crie um e-mail/senha para cada um de vocês. Não existe cadastro público no app — só quem for criado manualmente ali consegue entrar.

### 3. Ativar o GitHub Pages
No repositório do GitHub → Settings → Pages → Source: selecione a branch `main` e a pasta `/ (root)`. Depois de salvar, o GitHub gera uma URL tipo:
`https://seu-usuario.github.io/gestao-financeira/`

Essa é a URL que vocês vão acessar direto do celular ou computador, sem precisar abrir arquivo local.

> **Atualização**: o app migrou para o Vercel (para suportar a leitura de cupom fiscal com IA, que precisa de uma função de servidor). O GitHub Pages não é mais necessário — veja o passo 4.

### 4. Hospedagem no Vercel
1. Crie conta em [vercel.com](https://vercel.com) com "Continue with GitHub"
2. "Add New" → "Project" → importe o repositório `gestao-financeira`
3. Framework Preset: "Other" — não precisa mexer em build command
4. Deploy

### 5. Configurar a chave do Gemini (leitura de cupom fiscal)
1. Gere uma chave gratuita em [aistudio.google.com](https://aistudio.google.com) (Google AI Studio → "Get API key")
2. No painel do Vercel: abra o projeto → **Settings → Environment Variables**
3. Adicione uma variável:
   - Nome: `GEMINI_API_KEY`
   - Valor: a chave gerada
   - Ambiente: marque "Production", "Preview" e "Development"
4. Clique em "Save"
5. **Importante**: depois de adicionar a variável, é preciso fazer um novo deploy pra ela valer — vá em "Deployments", nos três pontinhos do último deploy, clique em "Redeploy"

A chave nunca fica visível no código do site — ela só existe dentro do servidor do Vercel, acessada pela função em `/api/scan-cupom.js`.

## Estrutura do projeto
```
index.html
css/styles.css
js/app.js              -> autenticação e navegação entre módulos/submódulos
js/firebase-config.js  -> credenciais do Firebase
js/helpers.js          -> formatação, seletor de mês, categorias compartilhadas
js/modules/
  dashboard.js          -> filtros por mês, pessoa e categoria
  contasFixas.js        -> contas recorrentes com status por mês
  variaveis.js          -> gastos do dia a dia, espelha pro Cartão quando é crédito
  mercado.js            -> Compra (com edição e histórico por mês), Itens em uso, Lista de compras
  cartao.js             -> Cartões, Vale Alimentação, Lançamentos, Faturas futuras
  renda.js              -> contas, renda mensal, caixas de reserva
firestore.rules
api/scan-cupom.js       -> função serverless (Vercel) para leitura de cupom via Gemini
package.json
```

## Coleções do Firestore
- `contasFixas` — modelos de conta fixa (sempre recorrentes)
- `contasFixasStatus` — status por mês: `pago` (com `valorPago`/`contaPagamentoId`), `ignorado` (removida só daquele mês, sem mexer em saldo) ou ausente (pendente)
- `variaveisDespesas` — gastos do dia a dia (campo `contaSaidaId` quando pago à vista)
- `mercadoCompras` (itens sem categoria, com `marca` opcional, `desconto` e `valeTipo`: livre/voucher), `despensaItens` (1 registro por nome+marca, com quantidade/datas/status), `listaCompras` (autônoma: nome + quantidade + comprado)
- `cartoes` (com `limite`), `cartaoLancamentos` (campo `origem`: manual, mercado ou variaveis), `cartaoRecorrentes` (assinaturas/planos — aparecem em toda fatura a partir do mês de início), `valeAlimentacaoConfig` (com `valorMensalLivre`/`valorMensalVoucher`)
- `contasBancarias`, `entradas` (soma ao saldo — exceto se `previsto:true` e `efetivada:false`, quando só entra ao chegar a data, verificado toda vez que a tela abre), `reservas` (caixas de reserva), `receitasRecorrentes` (base da Projeção Financeira), `receitasRecorrentesStatus`

## Despensa (novo modelo)
Agora é **1 linha por item** (nome + marca), não mais 1 linha por compra. Comprar o mesmo item de novo atualiza a linha existente (quantidade, datas, status) em vez de criar uma nova. A "Frequência de compra" é calculada em tempo real, contando quantas compras do mês atual contêm aquele nome+marca — não é um campo salvo. Editar/Excluir afetam só o registro da despensa, nunca o histórico de compras.

## Projeção Financeira (mês a mês)
Ao selecionar um mês futuro no Dashboard, o cálculo soma, mês a mês, do mês seguinte ao atual até o mês selecionado:
- Receitas recorrentes (fixo por mês)
- − Contas fixas (fixo por mês)
- − Cartão: parcelas já lançadas + recorrências (assinaturas), pela competência de vencimento

Tudo somado ao saldo atual em conta. Variáveis e Mercado à vista **não entram** nessa conta: como descontam o saldo imediatamente no momento do lançamento (independente da data escolhida), já estão refletidos no "saldo atual" — somar de novo duplicaria. Os pagos no crédito já estão contados dentro do Cartão.

## Saldo Previsto (fim do mês) — modelo Mobills
No mês atual (não projeção futura), o Dashboard mostra uma 4ª caixinha ao lado de "Saídas do mês": **Saldo previsto (fim do mês)**, inspirado no conceito de "efetivado vs. pendente" do Mobills — `Saldo Atual + Receitas pendentes − Despesas pendentes`. Aqui, "pendente" significa: receitas recorrentes ainda não marcadas como recebidas neste mês, contas fixas ainda não pagas (nem removidas do mês), e o total do Cartão do mês (que nunca desconta o saldo diretamente). Receitas Recorrentes têm um botão "Marcar como recebida" por mês (em Renda e Reservas) — use quando o valor já tiver sido lançado em Entradas, pra evitar contar duas vezes.

## Vale Alimentação Flex — saldo acumulado mês a mês
O valor cadastrado em Cartão › Vale (por mês, Livre e Voucher separados) é tratado como **entrada adicional**, não como o saldo total do mês. A fórmula: `Saldo disponível = Restante do mês anterior + Entrada deste mês`; `Saldo restante = Disponível − Gasto do mês`. O cálculo percorre todos os meses desde o primeiro com dado cadastrado até o mês selecionado — tanto no Dashboard quanto em Cartão › Vale.

## Vale Alimentação Flex (Livre + Voucher)
Como o cartão é flex, os dois saldos são controlados separadamente: cadastro mensal, consumo e saldo restante próprios para Livre e para Voucher, tanto em Cartão › Vale quanto no Dashboard.

## Contas Fixas: remover de um mês específico
Quando uma conta normalmente fixa (ex: crédito de celular) for paga por outro meio naquele mês (ex: cartão), use "Remover deste mês" em vez de "Marcar como pago". Isso só tira a conta da lista de pendentes/projeção daquele mês — não mexe em saldo algum. O gasto real deve ser lançado separadamente em Variáveis ou direto no Cartão.

## Cartão de Crédito: competência vs. vencimento
Toda compra no cartão agora é jogada na fatura pelo **mês de vencimento**, não pela data da compra — usando os campos "dia de fechamento" e "dia de vencimento" cadastrados em cada cartão. Regra: se o dia da compra for depois do fechamento, ela entra no ciclo seguinte; a fatura "pertence" ao mês em que vence. Parcelas seguem a partir desse mês-base, uma por mês. Cartões sem fechamento/vencimento cadastrado caem no comportamento antigo (mês da compra).
Essa lógica é usada em: Cartão › Lançamentos, Cartão › Faturas futuras (com filtro por cartão), Cartão › visão detalhada por cartão, e no total consolidado do Dashboard.

## Tema visual
O app usa o tema **Azul Pastel** (fundo claro, cards brancos com sombra suave, acento azul + dourado, fontes Manrope/Inter). Toda a identidade visual está centralizada em variáveis CSS no topo do `css/styles.css` — trocar de tema no futuro é só reescrever esse bloco `:root`, sem tocar em HTML ou JS (com exceção de 3 barras de progresso que usam `var(--blue-strong)` diretamente no JS, em `cartao.js` e `dashboard.js`).

## Hospedagem
O app roda no **Vercel** (necessário para a leitura de cupom fiscal via Gemini funcionar, já que depende de uma função de servidor). O GitHub Pages configurado anteriormente não deve mais ser usado — ele não executa a pasta `/api`, então a leitura de cupom nunca vai funcionar por ali. Se o GitHub Pages ainda estiver ativo, considere desativá-lo em Settings → Pages → Source → None, para evitar confusão entre as duas URLs.


## Próximos passos sugeridos
- Filtro de data/mês nos submódulos de Mercado (ainda não implementado, ficou pendente de decisão)
- Autocomplete de itens já cadastrados na tela de Mercado
- Comparação de preço entre mercados/marcas
