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
- `contasFixas` — modelos de conta fixa (agora sempre recorrentes, sem opção de conta única)
- `contasFixasStatus` — status de pagamento por mês (`templateId` + `mes` + `valorPago` + `contaPagamentoId`)
- `variaveisDespesas` — gastos do dia a dia (campo `contaSaidaId` quando pago à vista)
- `mercadoCompras` (itens sem categoria, com `marca` opcional), `despensaItens` (1 registro por nome+marca, com quantidade/datas/status), `listaCompras` (autônoma: nome + quantidade + comprado)
- `cartoes`, `cartaoLancamentos` (campo `origem`: manual, mercado ou variaveis), `valeAlimentacaoConfig`
- `contasBancarias`, `entradas` (lançamentos de entrada — soma ao saldo), `reservas` (caixas de reserva), `receitasRecorrentes` (base da Projeção Financeira)

## Despensa (novo modelo)
Agora é **1 linha por item** (nome + marca), não mais 1 linha por compra. Comprar o mesmo item de novo atualiza a linha existente (quantidade, datas, status) em vez de criar uma nova. A "Frequência de compra" é calculada em tempo real, contando quantas compras do mês atual contêm aquele nome+marca — não é um campo salvo. Editar/Excluir afetam só o registro da despensa, nunca o histórico de compras.

## Projeção Financeira
Ao selecionar um mês futuro no Dashboard, o card "Saldo em contas" vira "Saldo Projetado", calculado como:
`Saldo atual em conta + (nº de meses à frente × (Receitas Recorrentes − Contas Fixas))`
Cadastre as receitas recorrentes em Renda e Reservas. Gastos de Mercado, Cartão e Variáveis **não** entram na projeção, por serem imprevisíveis.

## Pendente de definição
A regra de "competência vs. vencimento" no módulo Cartão de Crédito (jogar a fatura pro mês de vencimento, não da compra) ainda não foi implementada — aguardando confirmação da regra de fechamento/vencimento.

## Hospedagem
O app roda no **Vercel** (necessário para a leitura de cupom fiscal via Gemini funcionar, já que depende de uma função de servidor). O GitHub Pages configurado anteriormente não deve mais ser usado — ele não executa a pasta `/api`, então a leitura de cupom nunca vai funcionar por ali. Se o GitHub Pages ainda estiver ativo, considere desativá-lo em Settings → Pages → Source → None, para evitar confusão entre as duas URLs.


## Próximos passos sugeridos
- Filtro de data/mês nos submódulos de Mercado (ainda não implementado, ficou pendente de decisão)
- Autocomplete de itens já cadastrados na tela de Mercado
- Comparação de preço entre mercados/marcas
