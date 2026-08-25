export function formatBRL(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthRef() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthRefFromDate(dateStr) {
  return dateStr ? dateStr.slice(0, 7) : currentMonthRef();
}

export function daysBetween(dateStr1, dateStr2) {
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// Calcula em que mês (competência) uma compra vai aparecer na fatura,
// considerando dia de fechamento e vencimento do cartão. Sem esses dados, usa o mês da compra.
export function calcularMesFatura(dataCompra, diaFechamento, diaVencimento) {
  if (!diaFechamento || !diaVencimento) return monthRefFromDate(dataCompra);
  const [ano, mes, dia] = dataCompra.split('-').map(Number);

  let mesFechamento = mes, anoFechamento = ano;
  if (dia > diaFechamento) {
    mesFechamento += 1;
    if (mesFechamento > 12) { mesFechamento = 1; anoFechamento += 1; }
  }

  let mesVencimento = mesFechamento, anoVencimento = anoFechamento;
  if (diaVencimento < diaFechamento) {
    mesVencimento += 1;
    if (mesVencimento > 12) { mesVencimento = 1; anoVencimento += 1; }
  }

  return `${anoVencimento}-${String(mesVencimento).padStart(2, '0')}`;
}

export function monthsBetween(mesInicio, mesFim) {
  const [y1, m1] = mesInicio.split('-').map(Number);
  const [y2, m2] = mesFim.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1);
}

export function addMonths(mesRef, delta) {
  const [y, m] = mesRef.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(mesRef) {
  const [y, m] = mesRef.split('-').map(Number);
  const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${nomes[m - 1]} de ${y}`;
}

export function monthPickerHTML(mesRef, idPrefix = 'mp') {
  return `<div class="month-picker">
    <button class="mp-btn" id="${idPrefix}-prev" type="button">‹</button>
    <span class="mp-label">${monthLabel(mesRef)}</span>
    <button class="mp-btn" id="${idPrefix}-next" type="button">›</button>
  </div>`;
}

export function wireMonthPicker(idPrefix, mesRef, onChange) {
  document.getElementById(`${idPrefix}-prev`).addEventListener('click', () => onChange(addMonths(mesRef, -1)));
  document.getElementById(`${idPrefix}-next`).addEventListener('click', () => onChange(addMonths(mesRef, 1)));
}

export function formatConta(conta) {
  return `${conta.pessoa} - ${conta.tipo} - ${conta.nome}`;
}

export function formatCartao(cartao) {
  return `${cartao.apelido} - ${cartao.titular}`;
}

export const CATEGORIAS_GASTO = ['Mercado', 'Delivery', 'Streaming', 'Mercado Livre', 'Recarga de celular', 'Transporte', 'Livros', 'Educação', 'Beleza', 'Assinaturas', 'Lazer', 'Vestuário', 'Saúde', 'Casa', 'Saque / Espécie', 'Outros'];

const LABELS_FORMA_PAGAMENTO = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix', vale: 'Vale' };

// Uma compra do Mercado pode ter pagamento dividido em várias formas (compra.pagamentos = [{formaPagamento, valor, ...}]).
// Compras antigas ainda têm só um formaPagamento no nível raiz — as funções abaixo tratam os dois formatos.

// Soma dos pagamentos de uma compra que caíram no Vale Alimentação, filtrando por titular e tipo (livre/voucher).
export function valorValeDaCompra(compra, titular, tipo) {
  if (Array.isArray(compra.pagamentos)) {
    return compra.pagamentos
      .filter(p => p.formaPagamento === 'vale' && p.valeTitular === titular && (p.valeTipo || 'livre') === tipo)
      .reduce((s, p) => s + (p.valor || 0), 0);
  }
  return (compra.formaPagamento === 'vale' && compra.valeTitular === titular && (compra.valeTipo || 'livre') === tipo)
    ? (compra.valorTotal || 0) : 0;
}

// Valor de uma compra que não foi pago no vale (ou seja, saiu do caixa do casal de alguma forma).
export function valorNaoValeDaCompra(compra) {
  if (Array.isArray(compra.pagamentos)) {
    const vale = compra.pagamentos.filter(p => p.formaPagamento === 'vale').reduce((s, p) => s + (p.valor || 0), 0);
    return Math.max(0, (compra.valorTotal || 0) - vale);
  }
  return compra.formaPagamento === 'vale' ? 0 : (compra.valorTotal || 0);
}

// Rótulo curto pra exibir a(s) forma(s) de pagamento de uma compra em tabelas/históricos.
export function formatFormasPagamento(compra) {
  if (Array.isArray(compra.pagamentos)) {
    if (compra.pagamentos.length === 1) {
      return LABELS_FORMA_PAGAMENTO[compra.pagamentos[0].formaPagamento] || compra.pagamentos[0].formaPagamento;
    }
    return `Dividido (${compra.pagamentos.map(p => LABELS_FORMA_PAGAMENTO[p.formaPagamento] || p.formaPagamento).join(' + ')})`;
  }
  return LABELS_FORMA_PAGAMENTO[compra.formaPagamento] || compra.formaPagamento || '-';
}

export function collapsibleHeaderHTML(id, title) {
  return `
    <div class="collapsible-header" data-toggle-target="${id}">
      <h3 style="margin:0">${title}</h3>
      <button class="btn-ghost btn-collapse" type="button">Recolher / expandir</button>
    </div>
  `;
}

export function wireCollapsible(container) {
  container.querySelectorAll('[data-toggle-target]').forEach(header => {
    header.querySelector('.btn-collapse')?.addEventListener('click', () => {
      const target = document.getElementById(header.dataset.toggleTarget);
      target.classList.toggle('collapsed');
    });
  });
}
