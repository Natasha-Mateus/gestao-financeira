import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, currentMonthRef, monthRefFromDate, uid,
  monthPickerHTML, wireMonthPicker, formatCartao, formatConta, CATEGORIAS_GASTO,
  collapsibleHeaderHTML, wireCollapsible, formatFormasPagamento
} from '../helpers.js';
import { getCartoes, upsertLancamentoEspelho, removerLancamentosEspelhoDeOrigem } from './cartao.js';
import { getContas } from './renda.js';
import { ajustarSaldoConta } from '../saldoService.js';

const variaveisCol = collection(db, 'variaveisDespesas');

export function renderVariaveis(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let editandoId = null;
  let edicaoOriginal = null;
  let cartoes = [];
  let contasDisponiveis = [];
  let pagamentosTemp = [{ id: uid(), formaPagamento: 'dinheiro' }];

  container.innerHTML = `
    <h2 class="module-title">Variáveis</h2>
    <p style="color:var(--text-dim); font-size:13px; margin-top:-14px">Registre aqui as despesas do dia a dia, depois de já terem acontecido. Uma despesa de Mercado lançada aqui (sem controle de itens) conta junto com o Mercado detalhado nos totais do Dashboard.</p>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-var-body', 'Nova despesa')}
      <div id="form-var-body" class="collapsible-body collapsed">
        <div id="var-editando-aviso" style="display:none; color:var(--gold); font-size:13px; margin-bottom:10px"></div>
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Data</label><input type="date" id="v-data" value="${todayISO()}"></div>
          <div><label>Descrição</label><input type="text" id="v-descricao" placeholder="Ex: Farmácia"></div>
          <div><label>Categoria</label>
            <select id="v-categoria">${CATEGORIAS_GASTO.map(c => `<option>${c}</option>`).join('')}</select>
          </div>
          <div><label>Quem gastou</label>
            <select id="v-pessoa"><option>Natasha</option><option>Daniel</option><option>Casal</option></select>
          </div>
          <div><label>Valor total</label><input type="number" step="0.01" id="v-valor"></div>
        </div>

        <h3 style="margin-top:20px">Forma(s) de pagamento</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:-8px">Pode dividir entre mais de uma forma de pagamento (ex: parte no cartão, parte no vale).</p>
        <div id="v-pagamentos-lista" style="margin-top:12px"></div>
        <button class="btn-ghost" id="btn-add-pagamento-var" style="margin-top:4px">+ Adicionar forma de pagamento</button>
        <div id="v-restante-pagamento" style="margin-top:10px; font-size:13px"></div>

        <div style="display:flex; gap:8px; margin-top:16px">
          <button class="btn-ghost" id="btn-cancelar-var" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-var">Adicionar despesa</button>
        </div>
      </div>
    </div>

    <div id="mp-slot-var">${monthPickerHTML(mes)}</div>
    <div class="filters-bar">
      <select id="filtro-categoria-var">
        <option value="todas">Todas as categorias</option>
        ${CATEGORIAS_GASTO.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="lista-var"></div>
  `;
  wireCollapsible(container);

  let filtroCategoria = 'todas';

  (async function preencherCartoes() {
    cartoes = await getCartoes();
    renderPagamentosLista();
  })();

  (async function preencherContas() {
    contasDisponiveis = await getContas();
    renderPagamentosLista();
  })();

  document.getElementById('v-valor').addEventListener('input', atualizarRestante);

  document.getElementById('filtro-categoria-var').addEventListener('change', (e) => {
    filtroCategoria = e.target.value;
    carregarLista();
  });

  function refreshMonthPicker() {
    document.getElementById('mp-slot-var').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); carregarLista(); });
  }
  refreshMonthPicker();

  // ===== Pagamentos (split) =====
  function sincronizarPagamentosTemp() {
    document.querySelectorAll('#v-pagamentos-lista [data-pagamento-id]').forEach(row => {
      const p = pagamentosTemp.find(x => x.id === row.dataset.pagamentoId);
      if (!p) return;
      p.formaPagamento = row.querySelector('.p-forma').value;
      const valorInput = row.querySelector('.p-valor');
      if (valorInput) p.valor = valorInput.value;
      const cartaoSel = row.querySelector('.p-cartao');
      if (cartaoSel) p.cartaoId = cartaoSel.value;
      const parceladoSel = row.querySelector('.p-parcelado');
      if (parceladoSel) p.parcelado = parceladoSel.value;
      const parcelasInp = row.querySelector('.p-parcelas');
      if (parcelasInp) p.numParcelas = parcelasInp.value;
      const valeTitularSel = row.querySelector('.p-vale-titular');
      if (valeTitularSel) p.valeTitular = valeTitularSel.value;
      const valeTipoSel = row.querySelector('.p-vale-tipo');
      if (valeTipoSel) p.valeTipo = valeTipoSel.value;
      const contaSel = row.querySelector('.p-conta');
      if (contaSel) p.contaSaidaId = contaSel.value;
    });
  }

  function pagamentoRowHTML(p, multiplo) {
    const forma = p.formaPagamento || 'dinheiro';
    const isCredito = forma === 'credito';
    const isVale = forma === 'vale';
    const isAVista = ['dinheiro', 'debito', 'pix'].includes(forma);
    return `
      <div class="pagamento-row" data-pagamento-id="${p.id}" style="border:1px solid var(--border); border-radius:8px; padding:14px; margin-bottom:12px">
        <div class="grid grid-4">
          <div><label>Forma de pagamento</label>
            <select class="p-forma">
              <option value="dinheiro" ${forma === 'dinheiro' ? 'selected' : ''}>Dinheiro</option>
              <option value="debito" ${forma === 'debito' ? 'selected' : ''}>Débito</option>
              <option value="credito" ${forma === 'credito' ? 'selected' : ''}>Crédito</option>
              <option value="pix" ${forma === 'pix' ? 'selected' : ''}>Pix</option>
              <option value="vale" ${forma === 'vale' ? 'selected' : ''}>Vale Alimentação</option>
            </select>
          </div>
          ${multiplo ? `<div><label>Valor desta parte</label><input type="number" step="0.01" class="p-valor" value="${p.valor ?? ''}"></div>` : ''}
          <div class="p-cartao-wrap conditional ${isCredito ? 'show' : ''}">
            <label>Qual cartão</label>
            <select class="p-cartao">${cartoes.map(c => `<option value="${c.id}" ${p.cartaoId === c.id ? 'selected' : ''}>${formatCartao(c)}</option>`).join('')}</select>
          </div>
          <div class="p-parcelado-wrap conditional ${isCredito ? 'show' : ''}">
            <label>Parcelado?</label>
            <select class="p-parcelado"><option value="nao" ${p.parcelado !== 'sim' ? 'selected' : ''}>Não</option><option value="sim" ${p.parcelado === 'sim' ? 'selected' : ''}>Sim</option></select>
          </div>
          <div class="p-parcelas-wrap conditional ${isCredito && p.parcelado === 'sim' ? 'show' : ''}">
            <label>Número de parcelas</label><input type="number" class="p-parcelas" min="2" value="${p.numParcelas || ''}">
          </div>
          <div class="p-vale-titular-wrap conditional ${isVale ? 'show' : ''}">
            <label>De quem é o vale</label>
            <select class="p-vale-titular"><option ${(!p.valeTitular || p.valeTitular === 'Natasha') ? 'selected' : ''}>Natasha</option><option ${p.valeTitular === 'Daniel' ? 'selected' : ''}>Daniel</option></select>
          </div>
          <div class="p-vale-tipo-wrap conditional ${isVale ? 'show' : ''}">
            <label>Tipo de saldo</label>
            <select class="p-vale-tipo"><option value="livre" ${(p.valeTipo || 'livre') === 'livre' ? 'selected' : ''}>Livre</option><option value="voucher" ${p.valeTipo === 'voucher' ? 'selected' : ''}>Voucher</option></select>
          </div>
          <div class="p-conta-wrap conditional ${isAVista ? 'show' : ''}">
            <label>Conta de saída</label>
            <select class="p-conta">
              <option value="">Selecione a conta</option>
              ${contasDisponiveis.map(c => `<option value="${c.id}" ${p.contaSaidaId === c.id ? 'selected' : ''}>${formatConta(c)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${multiplo ? `<button class="btn-danger" data-remove-pagamento="${p.id}" style="margin-top:8px">Remover esta forma</button>` : ''}
      </div>
    `;
  }

  function renderPagamentosLista() {
    const el = document.getElementById('v-pagamentos-lista');
    if (!el) return;
    const multiplo = pagamentosTemp.length > 1;
    el.innerHTML = pagamentosTemp.map(p => pagamentoRowHTML(p, multiplo)).join('');

    el.querySelectorAll('.p-forma, .p-parcelado').forEach(sel => {
      sel.addEventListener('change', () => { sincronizarPagamentosTemp(); renderPagamentosLista(); });
    });
    el.querySelectorAll('.p-valor').forEach(inp => {
      inp.addEventListener('input', () => { sincronizarPagamentosTemp(); atualizarRestante(); });
    });
    el.querySelectorAll('[data-remove-pagamento]').forEach(btn => {
      btn.addEventListener('click', () => {
        sincronizarPagamentosTemp();
        if (pagamentosTemp.length <= 1) return;
        pagamentosTemp = pagamentosTemp.filter(p => p.id !== btn.dataset.removePagamento);
        renderPagamentosLista();
      });
    });
    atualizarRestante();
  }

  document.getElementById('btn-add-pagamento-var').addEventListener('click', () => {
    sincronizarPagamentosTemp();
    const total = parseFloat(document.getElementById('v-valor').value) || 0;
    const somaAtual = pagamentosTemp.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
    const restante = Math.max(0, total - somaAtual);
    pagamentosTemp.push({ id: uid(), formaPagamento: 'dinheiro', valor: restante || '' });
    renderPagamentosLista();
  });

  function atualizarRestante() {
    const restanteEl = document.getElementById('v-restante-pagamento');
    if (!restanteEl) return;
    if (pagamentosTemp.length <= 1) { restanteEl.innerHTML = ''; return; }
    const total = parseFloat(document.getElementById('v-valor').value) || 0;
    const soma = Array.from(document.querySelectorAll('#v-pagamentos-lista .p-valor')).reduce((s, inp) => s + (parseFloat(inp.value) || 0), 0);
    const restante = total - soma;
    if (Math.abs(restante) < 0.01) {
      restanteEl.innerHTML = `<span style="color:var(--olive)">✓ As partes somam o valor total (${formatBRL(total)}).</span>`;
    } else if (restante > 0) {
      restanteEl.innerHTML = `<span style="color:var(--terracota)">Faltam alocar ${formatBRL(restante)} para bater com o total (${formatBRL(total)}).</span>`;
    } else {
      restanteEl.innerHTML = `<span style="color:var(--terracota)">As partes somam ${formatBRL(Math.abs(restante))} a mais que o total (${formatBRL(total)}).</span>`;
    }
  }

  function resetForm() {
    editandoId = null;
    edicaoOriginal = null;
    pagamentosTemp = [{ id: uid(), formaPagamento: 'dinheiro' }];
    document.getElementById('var-editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-var').style.display = 'none';
    document.getElementById('btn-add-var').textContent = 'Adicionar despesa';
    document.getElementById('v-data').value = todayISO();
    document.getElementById('v-descricao').value = '';
    document.getElementById('v-valor').value = '';
    renderPagamentosLista();
  }
  document.getElementById('btn-cancelar-var').addEventListener('click', resetForm);

  document.getElementById('btn-add-var').addEventListener('click', async () => {
    const valorTotal = parseFloat(document.getElementById('v-valor').value) || 0;
    if (valorTotal <= 0) { alert('Preencha o valor da despesa.'); return; }

    sincronizarPagamentosTemp();
    const multiplo = pagamentosTemp.length > 1;
    const pagamentos = [];
    for (const p of pagamentosTemp) {
      const formaPagamento = p.formaPagamento || 'dinheiro';
      const valor = multiplo ? (parseFloat(p.valor) || 0) : valorTotal;
      if (multiplo && valor <= 0) { alert('Preencha o valor de cada forma de pagamento.'); return; }
      const isCredito = formaPagamento === 'credito';
      const isVale = formaPagamento === 'vale';
      const isAVista = ['dinheiro', 'debito', 'pix'].includes(formaPagamento);
      if (isCredito && !p.cartaoId) { alert('Selecione o cartão em cada forma de pagamento no crédito.'); return; }
      if (isAVista && !p.contaSaidaId) { alert('Selecione de qual conta saiu cada forma de pagamento à vista.'); return; }
      pagamentos.push({
        id: p.id || uid(),
        formaPagamento, valor,
        cartaoId: isCredito ? p.cartaoId : null,
        parcelado: isCredito && p.parcelado === 'sim',
        numParcelas: (isCredito && p.parcelado === 'sim') ? (parseInt(p.numParcelas) || 1) : 1,
        valeTitular: isVale ? (p.valeTitular || 'Natasha') : null,
        valeTipo: isVale ? (p.valeTipo || 'livre') : null,
        contaSaidaId: isAVista ? p.contaSaidaId : null
      });
    }
    if (multiplo) {
      const soma = pagamentos.reduce((s, p) => s + p.valor, 0);
      if (Math.abs(soma - valorTotal) >= 0.01) {
        alert(`A soma das formas de pagamento (${formatBRL(soma)}) não bate com o valor total (${formatBRL(valorTotal)}).`);
        return;
      }
    }

    const payload = {
      data: document.getElementById('v-data').value,
      descricao: document.getElementById('v-descricao').value || 'Sem descrição',
      categoria: document.getElementById('v-categoria').value,
      pessoa: document.getElementById('v-pessoa').value,
      valorTotal,
      pagamentos
    };

    let despesaId;
    if (editandoId) {
      despesaId = editandoId;
      await updateDoc(doc(db, 'variaveisDespesas', despesaId), payload);
      // Reverte o débito das partes à vista antigas antes de aplicar as novas
      for (const p of (edicaoOriginal?.pagamentos || [])) {
        const isAVistaAntiga = ['dinheiro', 'debito', 'pix'].includes(p.formaPagamento);
        if (isAVistaAntiga && p.contaSaidaId) {
          await ajustarSaldoConta(p.contaSaidaId, p.valor);
        }
      }
    } else {
      const ref = await addDoc(variaveisCol, payload);
      despesaId = ref.id;
    }

    // Recria do zero os lançamentos-espelho no Cartão (um por parte no crédito)
    await removerLancamentosEspelhoDeOrigem('variaveis', despesaId);
    for (const p of pagamentos) {
      if (p.formaPagamento !== 'credito') continue;
      await upsertLancamentoEspelho({
        origem: 'variaveis', origemId: `${despesaId}::${p.id}`, cartaoId: p.cartaoId, valorTotal: p.valor,
        parcelado: p.parcelado, numParcelas: p.numParcelas, data: payload.data,
        descricao: multiplo ? `${payload.descricao} - parte` : payload.descricao, categoria: payload.categoria
      });
    }

    let algumSaldoNegativo = false;
    for (const p of pagamentos) {
      const isAVista = ['dinheiro', 'debito', 'pix'].includes(p.formaPagamento);
      if (isAVista && p.contaSaidaId) {
        const novoSaldo = await ajustarSaldoConta(p.contaSaidaId, -p.valor);
        if (novoSaldo !== null && novoSaldo < 0) algumSaldoNegativo = true;
      }
    }
    if (algumSaldoNegativo) {
      alert('Despesa registrada. Atenção: o saldo de alguma conta usada ficou negativo.');
    }

    resetForm();
  });


  let unsub = null;
  function carregarLista() {
    if (unsub) unsub();
    unsub = onSnapshot(query(variaveisCol), (snap) => {
      let despesas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(v => monthRefFromDate(v.data) === mes)
        .sort((a, b) => (b.data || '').localeCompare(a.data || ''));
      if (filtroCategoria !== 'todas') despesas = despesas.filter(v => v.categoria === filtroCategoria);

      const el = document.getElementById('lista-var');
      if (!despesas.length) {
        el.innerHTML = '<div class="empty-state">Nenhuma despesa registrada nesse mês.</div>';
        return;
      }
      const total = despesas.reduce((s, v) => s + v.valorTotal, 0);
      el.innerHTML = `
        <div class="card" style="margin-bottom:16px">
          <div class="ledger-figure"><div class="value">${formatBRL(total)}</div><div class="label">Total de variáveis em ${mes}</div></div>
        </div>
        <table>
          <thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Quem</th><th>Pagamento</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            ${despesas.map(v => `
              <tr>
                <td>${formatDate(v.data)}</td>
                <td>${v.descricao}</td>
                <td><span class="tag">${v.categoria}</span></td>
                <td>${v.pessoa}</td>
                <td>${formatFormasPagamento(v)}</td>
                <td>${formatBRL(v.valorTotal)}</td>
                <td>
                  <button class="btn-ghost" data-editar="${v.id}">Editar</button>
                  <button class="btn-danger" data-del="${v.id}">Excluir</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;

      el.querySelectorAll('[data-editar]').forEach(btn => {
        btn.addEventListener('click', () => {
          const v = despesas.find(x => x.id === btn.dataset.editar);
          editandoId = v.id;
          const pagamentosOriginais = Array.isArray(v.pagamentos)
            ? v.pagamentos
            : [{ id: uid(), formaPagamento: v.formaPagamento, valor: v.valorTotal, cartaoId: v.cartaoId || null,
                 parcelado: v.parcelado ? 'sim' : 'nao', numParcelas: v.numParcelas || null,
                 valeTitular: v.valeTitular || null, valeTipo: v.valeTipo || null, contaSaidaId: v.contaSaidaId || null }];
          edicaoOriginal = { valorTotal: v.valorTotal || 0, pagamentos: pagamentosOriginais };

          document.getElementById('form-var-body').classList.remove('collapsed');
          document.getElementById('var-editando-aviso').style.display = 'block';
          document.getElementById('var-editando-aviso').textContent = `Editando: ${v.descricao}`;
          document.getElementById('btn-cancelar-var').style.display = 'inline-block';
          document.getElementById('btn-add-var').textContent = 'Atualizar despesa';
          document.getElementById('v-data').value = v.data;
          document.getElementById('v-descricao').value = v.descricao;
          document.getElementById('v-categoria').value = v.categoria;
          document.getElementById('v-pessoa').value = v.pessoa;
          document.getElementById('v-valor').value = v.valorTotal;

          pagamentosTemp = pagamentosOriginais.map(p => ({
            id: uid(), formaPagamento: p.formaPagamento, valor: p.valor,
            cartaoId: p.cartaoId || null, parcelado: p.parcelado === true ? 'sim' : (p.parcelado || 'nao'),
            numParcelas: p.numParcelas || null, valeTitular: p.valeTitular || null, valeTipo: p.valeTipo || null,
            contaSaidaId: p.contaSaidaId || null
          }));
          renderPagamentosLista();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Excluir esta despesa??')) return;
          const v = despesas.find(x => x.id === btn.dataset.del);
          const partesAVista = Array.isArray(v?.pagamentos)
            ? v.pagamentos.filter(p => ['dinheiro', 'debito', 'pix'].includes(p.formaPagamento) && p.contaSaidaId)
            : (v?.contaSaidaId ? [{ contaSaidaId: v.contaSaidaId, valor: v.valorTotal }] : []);
          for (const p of partesAVista) {
            await ajustarSaldoConta(p.contaSaidaId, p.valor);
          }
          await deleteDoc(doc(db, 'variaveisDespesas', btn.dataset.del));
          await removerLancamentosEspelhoDeOrigem('variaveis', btn.dataset.del);
        });
      });
    });
    unsubs.push(() => { if (unsub) unsub(); });
  }

  carregarLista();
  return unsubs;
}
