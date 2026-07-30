import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, currentMonthRef, monthRefFromDate,
  monthPickerHTML, wireMonthPicker, formatCartao, formatConta, CATEGORIAS_GASTO,
  collapsibleHeaderHTML, wireCollapsible
} from '../helpers.js';
import { getCartoes, upsertLancamentoEspelho, removerLancamentoEspelho } from './cartao.js';
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
      <div id="form-var-body" class="collapsible-body">
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
          <div><label>Forma de pagamento</label>
            <select id="v-forma-pagamento">
              <option value="dinheiro">Dinheiro</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
              <option value="pix">Pix</option>
              <option value="vale">Vale Alimentação</option>
            </select>
          </div>
          <div id="v-cartao-wrap" class="conditional">
            <label>Qual cartão</label>
            <select id="v-cartao"></select>
          </div>
          <div id="v-conta-saida-wrap" class="conditional">
            <label>Conta de saída</label>
            <select id="v-conta-saida"><option value="">Selecione a conta</option></select>
          </div>
          <div id="v-parcelado-wrap" class="conditional">
            <label>Parcelado?</label>
            <select id="v-parcelado"><option value="nao">Não</option><option value="sim">Sim</option></select>
          </div>
          <div id="v-parcelas-wrap" class="conditional">
            <label>Número de parcelas</label><input type="number" id="v-parcelas" min="2">
          </div>
          <div id="v-vale-titular-wrap" class="conditional">
            <label>De quem é o vale</label>
            <select id="v-vale-titular"><option>Natasha</option><option>Daniel</option></select>
          </div>
        </div>
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

  (async function preencherCartoes() {
    const cartoes = await getCartoes();
    const select = document.getElementById('v-cartao');
    select.innerHTML = cartoes.map(c => `<option value="${c.id}">${formatCartao(c)}</option>`).join('');
  })();

  let contasDisponiveis = [];
  (async function preencherContas() {
    contasDisponiveis = await getContas();
    const select = document.getElementById('v-conta-saida');
    select.innerHTML = '<option value="">Selecione a conta</option>' +
      contasDisponiveis.map(c => `<option value="${c.id}">${formatConta(c)}</option>`).join('');
  })();

  document.getElementById('v-forma-pagamento').addEventListener('change', (e) => {
    const isCredito = e.target.value === 'credito';
    const isVale = e.target.value === 'vale';
    const isAVista = ['dinheiro', 'debito', 'pix'].includes(e.target.value);
    document.getElementById('v-cartao-wrap').classList.toggle('show', isCredito);
    document.getElementById('v-parcelado-wrap').classList.toggle('show', isCredito);
    document.getElementById('v-vale-titular-wrap').classList.toggle('show', isVale);
    document.getElementById('v-conta-saida-wrap').classList.toggle('show', isAVista);
    if (!isCredito) document.getElementById('v-parcelas-wrap').classList.remove('show');
  });
  document.getElementById('v-parcelado').addEventListener('change', (e) => {
    document.getElementById('v-parcelas-wrap').classList.toggle('show', e.target.value === 'sim');
  });

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
  }
  document.getElementById('btn-cancelar-var').addEventListener('click', resetForm);

  document.getElementById('btn-add-var').addEventListener('click', async () => {
    const formaPagamento = document.getElementById('v-forma-pagamento').value;
    const isAVista = ['dinheiro', 'debito', 'pix'].includes(formaPagamento);
    const contaSaidaId = isAVista ? document.getElementById('v-conta-saida').value : null;
    if (isAVista && !contaSaidaId) { alert('Selecione de qual conta esse gasto saiu.'); return; }

    const payload = {
      data: document.getElementById('v-data').value,
      descricao: document.getElementById('v-descricao').value || 'Sem descrição',
      categoria: document.getElementById('v-categoria').value,
      pessoa: document.getElementById('v-pessoa').value,
      valorTotal: parseFloat(document.getElementById('v-valor').value) || 0,
      formaPagamento,
      cartaoId: formaPagamento === 'credito' ? document.getElementById('v-cartao').value : null,
      contaSaidaId,
      parcelado: formaPagamento === 'credito' && document.getElementById('v-parcelado').value === 'sim',
      numParcelas: 1,
      valeTitular: formaPagamento === 'vale' ? document.getElementById('v-vale-titular').value : null
    };
    if (payload.parcelado) payload.numParcelas = parseInt(document.getElementById('v-parcelas').value) || 1;

    let despesaId;
    if (editandoId) {
      despesaId = editandoId;
      await updateDoc(doc(db, 'variaveisDespesas', despesaId), payload);
      // Reverte o débito anterior (se havia) antes de aplicar o novo
      if (edicaoOriginal && edicaoOriginal.contaSaidaId) {
        await ajustarSaldoConta(edicaoOriginal.contaSaidaId, edicaoOriginal.valorTotal);
      }
    } else {
      const ref = await addDoc(variaveisCol, payload);
      despesaId = ref.id;
    }

    if (formaPagamento === 'credito') {
      await upsertLancamentoEspelho({
        origem: 'variaveis', origemId: despesaId, cartaoId: payload.cartaoId,
        valorTotal: payload.valorTotal, parcelado: payload.parcelado, numParcelas: payload.numParcelas,
        data: payload.data, descricao: payload.descricao, categoria: payload.categoria
      });
    } else {
      await removerLancamentoEspelho('variaveis', despesaId);
    }

    if (contaSaidaId) {
      const novoSaldo = await ajustarSaldoConta(contaSaidaId, -payload.valorTotal);
      if (novoSaldo !== null && novoSaldo < 0) {
        alert('Gasto registrado. Atenção: o saldo dessa conta ficou negativo.');
      }
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
                <td>${v.formaPagamento}${v.formaPagamento === 'credito' ? ' 💳' : ''}</td>
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
          edicaoOriginal = { contaSaidaId: v.contaSaidaId || null, valorTotal: v.valorTotal || 0 };
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
          document.getElementById('v-forma-pagamento').value = v.formaPagamento;
          const isAVistaEdit = ['dinheiro', 'debito', 'pix'].includes(v.formaPagamento);
          document.getElementById('v-cartao-wrap').classList.toggle('show', v.formaPagamento === 'credito');
          document.getElementById('v-parcelado-wrap').classList.toggle('show', v.formaPagamento === 'credito');
          document.getElementById('v-vale-titular-wrap').classList.toggle('show', v.formaPagamento === 'vale');
          document.getElementById('v-conta-saida-wrap').classList.toggle('show', isAVistaEdit);
          if (v.cartaoId) document.getElementById('v-cartao').value = v.cartaoId;
          if (v.contaSaidaId) document.getElementById('v-conta-saida').value = v.contaSaidaId;
          if (v.parcelado) {
            document.getElementById('v-parcelado').value = 'sim';
            document.getElementById('v-parcelas-wrap').classList.add('show');
            document.getElementById('v-parcelas').value = v.numParcelas;
          }
          if (v.valeTitular) document.getElementById('v-vale-titular').value = v.valeTitular;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      el.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Excluir este gasto?')) return;
          const v = despesas.find(x => x.id === btn.dataset.del);
          if (v && v.contaSaidaId) {
            await ajustarSaldoConta(v.contaSaidaId, v.valorTotal);
          }
          await deleteDoc(doc(db, 'variaveisDespesas', btn.dataset.del));
          await removerLancamentoEspelho('variaveis', btn.dataset.del);
        });
      });
    });
    unsubs.push(() => { if (unsub) unsub(); });
  }

  carregarLista();
  return unsubs;
}
