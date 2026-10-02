import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, currentMonthRef, monthRefFromDate,
  monthPickerHTML, wireMonthPicker, formatCartao, formatConta, CATEGORIAS_GASTO,
  collapsibleHeaderHTML, wireCollapsible, FORMAS_A_VISTA, getPagamentos, resumoPagamentos
} from '../helpers.js';
import { criarFormPagamentos } from '../pagamentosForm.js';
import { getCartoes, upsertLancamentoEspelho, removerLancamentosEspelhoDaOrigem } from './cartao.js';
import { getContas } from './renda.js';
import { ajustarSaldoConta } from '../saldoService.js';

const variaveisCol = collection(db, 'variaveisDespesas');

export function renderVariaveis(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let editandoId = null;
  let edicaoOriginal = null;

  container.innerHTML = `
    <h2 class="module-title">Variáveis</h2>
    <p style="color:var(--text-dim); font-size:13px; margin-top:-14px">Registre aqui os gastos do dia a dia, depois de já terem acontecido.</p>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-var-body', 'Novo gasto')}
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
          <div><label>Valor</label><input type="number" step="0.01" id="v-valor"></div>
        </div>
        <h3 style="margin-top:8px">Pagamento</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Com uma forma só, ela paga o valor total. Para dividir (ex: parte no cartão, parte no vale), adicione outra forma e informe o valor de cada uma.</p>
        <div id="v-pagamentos-slot"></div>
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-var" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-var">Adicionar gasto</button>
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

  let cartoesDisponiveis = [];
  let contasDisponiveis = [];
  const pagForm = criarFormPagamentos({
    slotId: 'v-pagamentos-slot',
    getCartoes: () => cartoesDisponiveis,
    getContas: () => contasDisponiveis,
    getTotal: () => parseFloat(document.getElementById('v-valor').value) || 0
  });
  pagForm.render();
  document.getElementById('v-valor').addEventListener('input', () => pagForm.atualizarStatus());
  (async function carregarOpcoes() {
    cartoesDisponiveis = await getCartoes();
    contasDisponiveis = await getContas();
    pagForm.render();
  })();

  document.getElementById('filtro-categoria-var').addEventListener('change', (e) => {
    filtroCategoria = e.target.value;
    carregarLista();
  });

  function refreshMonthPicker() {
    document.getElementById('mp-slot-var').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); carregarLista(); });
  }
  refreshMonthPicker();

  function resetForm() {
    editandoId = null;
    edicaoOriginal = null;
    document.getElementById('var-editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-var').style.display = 'none';
    document.getElementById('btn-add-var').textContent = 'Adicionar gasto';
    document.getElementById('v-data').value = todayISO();
    document.getElementById('v-descricao').value = '';
    document.getElementById('v-valor').value = '';
    pagForm.reset();
  }
  document.getElementById('btn-cancelar-var').addEventListener('click', resetForm);

  document.getElementById('btn-add-var').addEventListener('click', async () => {
    const valorTotal = parseFloat(document.getElementById('v-valor').value) || 0;
    if (valorTotal <= 0) { alert('Informe o valor do gasto.'); return; }
    const coleta = pagForm.coletar(valorTotal);
    if (coleta.erro) { alert(coleta.erro); return; }
    const pagamentos = coleta.pagamentos;

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
      // Devolve às contas o que cada pagamento à vista anterior tinha debitado
      for (const p of (edicaoOriginal?.pagamentos || [])) {
        if (FORMAS_A_VISTA.includes(p.forma) && p.contaSaidaId) await ajustarSaldoConta(p.contaSaidaId, p.valor);
      }
    } else {
      const ref = await addDoc(variaveisCol, payload);
      despesaId = ref.id;
    }

    // Um lançamento no cartão por pagamento em crédito (refeito a cada salvamento)
    await removerLancamentosEspelhoDaOrigem('variaveis', despesaId);
    for (const p of pagamentos.filter(p => p.formaPagamento === 'credito')) {
      await upsertLancamentoEspelho({
        origem: 'variaveis', origemId: `${despesaId}#${p.id}`, cartaoId: p.cartaoId,
        valorTotal: p.valor, parcelado: p.parcelado, numParcelas: p.numParcelas,
        data: payload.data, descricao: payload.descricao, categoria: payload.categoria
      });
    }

    let saldoNegativo = false;
    for (const p of pagamentos.filter(p => p.contaSaidaId)) {
      const novoSaldo = await ajustarSaldoConta(p.contaSaidaId, -p.valor);
      if (novoSaldo !== null && novoSaldo < 0) saldoNegativo = true;
    }
    if (saldoNegativo) alert('Gasto registrado. Atenção: o saldo de uma das contas ficou negativo.');

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
        el.innerHTML = '<div class="empty-state">Nenhum gasto registrado nesse mês.</div>';
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
                <td>${resumoPagamentos(v)}${getPagamentos(v).some(p => p.forma === 'credito') ? ' 💳' : ''}</td>
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
          edicaoOriginal = { pagamentos: getPagamentos(v) };
          document.getElementById('form-var-body').classList.remove('collapsed');
          document.getElementById('var-editando-aviso').style.display = 'block';
          document.getElementById('var-editando-aviso').textContent = `Editando: ${v.descricao}`;
          document.getElementById('btn-cancelar-var').style.display = 'inline-block';
          document.getElementById('btn-add-var').textContent = 'Atualizar gasto';
          document.getElementById('v-data').value = v.data;
          document.getElementById('v-descricao').value = v.descricao;
          document.getElementById('v-categoria').value = v.categoria;
          document.getElementById('v-pessoa').value = v.pessoa;
          document.getElementById('v-valor').value = v.valorTotal;
          pagForm.definir(getPagamentos(v));
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Excluir este gasto?')) return;
          const v = despesas.find(x => x.id === btn.dataset.del);
          if (v) {
            for (const p of getPagamentos(v)) {
              if (FORMAS_A_VISTA.includes(p.forma) && p.contaSaidaId) await ajustarSaldoConta(p.contaSaidaId, p.valor);
            }
          }
          await deleteDoc(doc(db, 'variaveisDespesas', btn.dataset.del));
          await removerLancamentosEspelhoDaOrigem('variaveis', btn.dataset.del);
        });
      });
    });
    unsubs.push(() => { if (unsub) unsub(); });
  }

  carregarLista();
  return unsubs;
}
