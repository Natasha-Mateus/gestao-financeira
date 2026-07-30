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
- `contasFixas` — modelos de conta fixa (recorrentes ou únicas)
- `contasFixasStatus` — status de pagamento por mês (`templateId` + `mes` + `valorPago` + `contaPagamentoId`)
- `variaveisDespesas` — gastos do dia a dia (campo `contaSaidaId` quando pago à vista)
- `mercadoCompras`, `itensEmUso`, `listaCompras` (compras à vista também têm `contaSaidaId`)
- `cartoes`, `cartaoLancamentos` (campo `origem`: manual, mercado ou variaveis), `valeAlimentacaoConfig`
- `contasBancarias`, `rendaMensal`, `reservas` (caixas de reserva)

## Regras de saldo bancário
- Toda vez que uma conta fixa é paga, um gasto variável ou de mercado é registrado em dinheiro/débito/pix, o saldo da conta escolhida é debitado automaticamente.
- Editar ou excluir esses lançamentos reverte o débito antigo antes de aplicar o novo (evita duplicidade).
- O sistema permite saldo negativo (só avisa) — não bloqueia o registro, pois o saldo pode estar desatualizado.
- Vale Alimentação da Natasha é sempre tratado à parte: não debita conta bancária nem entra no "gasto real" do Dashboard.


## Próximos passos sugeridos
- Filtro de data/mês nos submódulos de Mercado (ainda não implementado, ficou pendente de decisão)
- Autocomplete de itens já cadastrados na tela de Mercado
- Comparação de preço entre mercados/marcas
