// Seção "Pagamento" com até MAX_PAGAMENTOS formas por lançamento (parte no cartão, parte no vale etc.).
// Grava cada pagamento no formato do app: { id, formaPagamento, valor, cartaoId, parcelado, numParcelas,
// valeTitular, valeTipo, contaSaidaId }.
import {
  formatBRL, formatCartao, formatConta, uid, ROTULO_FORMA, FORMAS_A_VISTA, MAX_PAGAMENTOS
} from './helpers.js';

const FORMAS = ['dinheiro', 'debito', 'pix', 'credito', 'vale'];

export function criarFormPagamentos({ slotId, getCartoes, getContas, getTotal }) {
  let lista = [novo()];

  function novo() {
    return {
      id: uid(), forma: 'dinheiro', valor: '', cartaoId: (getCartoes()[0] || {}).id || null,
      parcelado: false, numParcelas: 2, valeTitular: 'Natasha', valeTipo: 'livre', contaSaidaId: ''
    };
  }

  const slot = () => document.getElementById(slotId);

  function sincronizar() {
    const el = slot();
    if (!el) return;
    el.querySelectorAll('[data-pag-id]').forEach(row => {
      const p = lista.find(x => x.id === row.dataset.pagId);
      if (!p) return;
      const q = (sel) => row.querySelector(sel);
      p.forma = q('.p-forma').value;
      p.valor = q('.p-valor').value;
      if (q('.p-cartao')) p.cartaoId = q('.p-cartao').value;
      if (q('.p-parcelado')) p.parcelado = q('.p-parcelado').value === 'sim';
      if (q('.p-parcelas')) p.numParcelas = parseInt(q('.p-parcelas').value) || 2;
      if (q('.p-vale-titular')) p.valeTitular = q('.p-vale-titular').value;
      if (q('.p-vale-tipo')) p.valeTipo = q('.p-vale-tipo').value;
      if (q('.p-conta')) p.contaSaidaId = q('.p-conta').value;
    });
  }

  function camposExtra(p) {
    if (p.forma === 'credito') {
      return `
        <div><label>Qual cartão</label>
          <select class="p-cartao">${getCartoes().map(c => `<option value="${c.id}" ${p.cartaoId === c.id ? 'selected' : ''}>${formatCartao(c)}</option>`).join('')}</select>
        </div>
        <div><label>Parcelado?</label>
          <select class="p-parcelado"><option value="nao" ${!p.parcelado ? 'selected' : ''}>Não</option><option value="sim" ${p.parcelado ? 'selected' : ''}>Sim</option></select>
        </div>
        ${p.parcelado ? `<div><label>Número de parcelas</label><input type="number" min="2" class="p-parcelas" value="${p.numParcelas || 2}"></div>` : ''}`;
    }
    if (p.forma === 'vale') {
      return `
        <div><label>De quem é o vale</label>
          <select class="p-vale-titular"><option ${p.valeTitular === 'Natasha' ? 'selected' : ''}>Natasha</option><option ${p.valeTitular === 'Daniel' ? 'selected' : ''}>Daniel</option></select>
        </div>
        <div><label>Tipo de saldo</label>
          <select class="p-vale-tipo"><option value="livre" ${p.valeTipo !== 'voucher' ? 'selected' : ''}>Livre</option><option value="voucher" ${p.valeTipo === 'voucher' ? 'selected' : ''}>Voucher</option></select>
        </div>`;
    }
    return `
      <div><label>Conta de saída</label>
        <select class="p-conta">
          <option value="">Selecione a conta</option>
          ${getContas().map(c => `<option value="${c.id}" ${p.contaSaidaId === c.id ? 'selected' : ''}>${formatConta(c)}</option>`).join('')}
        </select>
      </div>`;
  }

  function render() {
    const el = slot();
    if (!el) return;
    const unico = lista.length === 1;
    el.innerHTML = `
      <div id="${slotId}-linhas">
        ${lista.map(p => `
          <div class="card" data-pag-id="${p.id}" style="margin-bottom:8px; padding:12px">
            <div class="grid grid-4" style="align-items:end">
              <div><label>Forma de pagamento</label>
                <select class="p-forma">${FORMAS.map(f => `<option value="${f}" ${p.forma === f ? 'selected' : ''}>${f === 'vale' ? 'Vale Alimentação' : ROTULO_FORMA[f]}</option>`).join('')}</select>
              </div>
              <div><label>Valor</label>
                <input type="number" step="0.01" class="p-valor" value="${unico ? '' : (p.valor ?? '')}" ${unico ? 'disabled placeholder="Valor total"' : 'placeholder="0,00"'}>
              </div>
              ${camposExtra(p)}
              ${unico ? '' : `<div><button class="btn-danger" data-remove-pag="${p.id}">Remover</button></div>`}
            </div>
          </div>`).join('')}
      </div>
      <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px">
        <button class="btn-ghost" id="${slotId}-add" ${lista.length >= MAX_PAGAMENTOS ? 'disabled' : ''}>+ Adicionar forma de pagamento</button>
        <span id="${slotId}-status" style="font-size:13px"></span>
      </div>`;

    el.querySelectorAll('.p-forma, .p-parcelado').forEach(sel => sel.addEventListener('change', () => { sincronizar(); render(); }));
    el.querySelectorAll('.p-valor').forEach(inp => inp.addEventListener('input', atualizarStatus));
    el.querySelectorAll('[data-remove-pag]').forEach(btn => btn.addEventListener('click', () => {
      sincronizar();
      lista = lista.filter(p => p.id !== btn.dataset.removePag);
      render();
    }));
    document.getElementById(`${slotId}-add`).addEventListener('click', (e) => {
      e.preventDefault();
      sincronizar();
      if (lista.length < MAX_PAGAMENTOS) { lista.push(novo()); render(); }
    });
    atualizarStatus();
  }

  function atualizarStatus() {
    const st = document.getElementById(`${slotId}-status`);
    if (!st) return;
    if (lista.length <= 1) { st.textContent = ''; return; }
    let soma = 0;
    slot().querySelectorAll('.p-valor').forEach(inp => { soma += parseFloat(inp.value) || 0; });
    const dif = Math.round(((getTotal() || 0) - soma) * 100) / 100;
    st.textContent = dif === 0 ? 'Os pagamentos batem com o total.' : dif > 0 ? `Faltam ${formatBRL(dif)} para alocar.` : `Passou ${formatBRL(-dif)} do total.`;
    st.style.color = dif === 0 ? 'var(--olive)' : 'var(--terracota)';
  }

  // Carrega pagamentos existentes (já normalizados por getPagamentos) para edição
  function definir(pagamentos) {
    const validos = (pagamentos || []).filter(p => ROTULO_FORMA[p.forma]);
    lista = validos.length
      ? validos.map(p => ({ ...novo(), ...p, id: (!p.id || p.id === 'legado') ? uid() : p.id, valor: p.valor ?? '' }))
      : [novo()];
    render();
  }

  function reset() { lista = [novo()]; render(); }

  // Valida e devolve { pagamentos } no formato de gravação, ou { erro }
  function coletar(total) {
    sincronizar();
    const round2 = (n) => Math.round(n * 100) / 100;
    const out = [];
    for (const p of lista) {
      const valor = lista.length === 1 ? round2(total) : round2(parseFloat(p.valor) || 0);
      if (valor <= 0) return { erro: 'Informe o valor de cada forma de pagamento.' };
      if (FORMAS_A_VISTA.includes(p.forma) && !p.contaSaidaId) return { erro: `Selecione de qual conta saiu o pagamento em ${ROTULO_FORMA[p.forma]}.` };
      if (p.forma === 'credito' && !p.cartaoId) return { erro: 'Selecione o cartão do pagamento no crédito.' };
      const credito = p.forma === 'credito';
      const parcelado = credito && !!p.parcelado;
      out.push({
        id: p.id, formaPagamento: p.forma, valor,
        cartaoId: credito ? p.cartaoId : null,
        parcelado,
        numParcelas: parcelado ? (parseInt(p.numParcelas) || 2) : 1,
        valeTitular: p.forma === 'vale' ? p.valeTitular : null,
        valeTipo: p.forma === 'vale' ? (p.valeTipo || 'livre') : null,
        contaSaidaId: FORMAS_A_VISTA.includes(p.forma) ? p.contaSaidaId : null
      });
    }
    const soma = round2(out.reduce((s, p) => s + p.valor, 0));
    if (Math.abs(soma - round2(total)) > 0.009) {
      return { erro: `A soma das formas de pagamento (${formatBRL(soma)}) precisa ser igual ao valor total (${formatBRL(total)}).` };
    }
    return { pagamentos: out };
  }

  return { render, definir, reset, coletar, atualizarStatus };
}
