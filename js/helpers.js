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

// ==================== PAGAMENTOS (split) ====================
export const FORMAS_A_VISTA = ['dinheiro', 'debito', 'pix'];
export const ROTULO_FORMA = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'Pix', vale: 'Vale' };
export const MAX_PAGAMENTOS = 5;

// Reconhece a forma de pagamento mesmo se foi gravada com outra grafia em versões antigas
// ("Vale Alimentação", "vale_alimentacao", "Débito" etc.). Devolve null se não reconhecer.
export function normalizarForma(f) {
  if (!f) return null;
  const t = String(f).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]/g, '');
  if (!t) return null;
  if (t.includes('vale') || t.includes('alimentacao') || t.includes('refeicao') || t === 'va' || t === 'vr') return 'vale';
  if (t.includes('debito')) return 'debito';
  if (t.includes('credito')) return 'credito';
  if (t.includes('pix')) return 'pix';
  if (t.includes('dinheiro') || t.includes('especie')) return 'dinheiro';
  return null;
}

// Sempre devolve a lista de pagamentos de uma compra. Compras antigas (forma única)
// são convertidas na hora em uma lista de 1 pagamento, sem precisar migrar o banco.
export function getPagamentos(compra) {
  if (Array.isArray(compra?.pagamentos) && compra.pagamentos.length) {
    // Cada pagamento grava a forma em 'formaPagamento' (formato do app); 'forma' também é aceito
    return compra.pagamentos.map(p => {
      const bruta = p.formaPagamento ?? p.forma;
      return { ...p, forma: normalizarForma(bruta) || bruta };
    });
  }
  // Sem forma gravada: se o registro ainda guarda os dados do vale (titular/tipo) ou do cartão, deduz a forma
  // a partir deles, para não precisar preencher de novo.
  let formaBruta = compra?.formaPagamento;
  if (!formaBruta && compra) {
    if (compra.valeTitular || compra.valeTipo) formaBruta = 'vale';
    else if (compra.cartaoId) formaBruta = 'credito';
  }
  if (!formaBruta) return [];
  const forma = normalizarForma(formaBruta) || formaBruta;
  return [{
    id: 'legado',
    forma,
    valor: compra.valorTotal || 0,
    cartaoId: compra.cartaoId || null,
    parcelado: !!compra.parcelado,
    numParcelas: compra.numParcelas || 1,
    valeTitular: compra.valeTitular || null,
    valeTipo: compra.valeTipo || (forma === 'vale' ? 'livre' : null),
    contaSaidaId: compra.contaSaidaId || null
  }];
}

export function resumoPagamentos(compra) {
  const pags = getPagamentos(compra);
  if (pags.length <= 1) return ROTULO_FORMA[pags[0]?.forma] || (pags[0]?.forma ? `? ${pags[0].forma}` : '-');
  return pags.map(p => `${ROTULO_FORMA[p.forma] || p.forma} ${formatBRL(p.valor)}`).join(' + ');
}

// Parte da compra paga com dinheiro "real" (tudo menos vale) — é o que conta no gasto do casal.
export function valorForaDoVale(compra) {
  return getPagamentos(compra).filter(p => p.forma !== 'vale').reduce((s, p) => s + (p.valor || 0), 0);
}

// Compra sem nenhuma forma de pagamento reconhecida (não dá pra saber se foi vale, cartão etc.)
export function semPagamentoReconhecido(compra) {
  const pags = getPagamentos(compra);
  return !pags.length || pags.some(p => !ROTULO_FORMA[p.forma]);
}
