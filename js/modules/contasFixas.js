import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, todayISO, currentMonthRef, monthPickerHTML, wireMonthPicker,
  formatConta, collapsibleHeaderHTML, wireCollapsible
} from '../helpers.js';
import { getContas } from './renda.js';
import { ajustarSaldoConta } from '../saldoService.js';

const contasFixasCol = collection(db, 'contasFixas');
const statusCol = collection(db, 'contasFixasStatus');

export function renderContasFixas(container) {
  const unsubs = [];
  let mes = currentMonthRef();
  let editandoId = null;

  container.innerHTML = `
    <h2 class="module-title">Contas Fixas</h2>
    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-cf-body', 'Nova conta fixa')}
      <div id="form-cf-body" class="collapsible-body collapsed">
        <div id="cf-editando-aviso" style="display:none; color:var(--gold); font-size:13px; margin-bottom:10px"></div>
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Nome</label><input type="text" id="cf-nome" placeholder="Ex: Aluguel"></div>
          <div><label>Valor</label><input type="number" step="0.01" id="cf-valor"></div>
          <div><label>Dia de vencimento</label><input type="number" id="cf-vencimento" min="1" max="31"></div>
          <div><label>Recorrência</label>
            <select id="cf-recorrente"><option value="sim">Conta recorrente (repete todo mês)</option><option value="nao">Conta única (só este mês)</option></select>
          </div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-cf" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-cf">Adicionar conta fixa</button>
        </div>
      </div>
    </div>
    <div id="mp-slot-cf">${monthPickerHTML(mes)}</div>
    <div id="lista-cf"></div>
  `;
  wireCollapsible(container);

  function refreshMonthPicker() {
    document.getElementById('mp-slot-cf').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); carregarLista(); });
  }
  refreshMonthPicker();

  function resetForm() {
    editandoId = null;
    document.getElementById('cf-editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-cf').style.display = 'none';
    document.getElementById('btn-add-cf').textContent = 'Adicionar conta fixa';
    document.getElementById('cf-nome').value = '';
    document.getElementById('cf-valor').value = '';
    document.getElementById('cf-vencimento').value = '';
    document.getElementById('cf-recorrente').value = 'sim';
  }

  document.getElementById('btn-cancelar-cf').addEventListener('click', resetForm);

  document.getElementById('btn-add-cf').addEventListener('click', async () => {
    const nome = document.getElementById('cf-nome').value;
    if (!nome) return;
    const payload = {
      nome,
      valor: parseFloat(document.getElementById('cf-valor').value) || 0,
      diaVencimento: parseInt(document.getElementById('cf-vencimento').value) || null,
      recorrente: document.getElementById('cf-recorrente').value === 'sim'
    };
    if (editandoId) {
      await updateDoc(doc(db, 'contasFixas', editandoId), payload);
    } else {
      await addDoc(contasFixasCol, payload);
    }
    resetForm();
  });

  let unsubTemplates = null;
  let unsubStatus = null;
  let latestTemplates = [];
  let latestStatus = [];

  async function carregarLista() {
    const contas = await getContas();
    if (unsubTemplates) unsubTemplates();
    if (unsubStatus) unsubStatus();

    function render() {
      const templates = latestTemplates;
      const statusDocs = latestStatus;
      const listaEl = document.getElementById('lista-cf');
      if (!templates.length) {
        listaEl.innerHTML = '<div class="empty-state">Nenhuma conta fixa cadastrada ainda.</div>';
        return;
      }
      listaEl.innerHTML = `
          <table>
            <thead><tr><th>Nome</th><th>Valor</th><th>Vencimento</th><th>Status (${mes})</th><th>Pago com</th><th></th></tr></thead>
            <tbody>
              ${templates.map(t => {
                const statusDoc = statusDocs.find(s => s.templateId === t.id && s.mes === mes);
                const status = statusDoc ? statusDoc.status : 'pendente';
                const contaPagante = statusDoc && contas.find(c => c.id === statusDoc.contaPagamentoId);
                return `
                <tr>
                  <td>${t.nome}${t.recorrente ? '' : ' <span class="tag">única</span>'}</td>
                  <td>${formatBRL(t.valor)}</td>
                  <td>dia ${t.diaVencimento || '-'}</td>
                  <td><span class="tag" style="${status === 'pago' ? 'color:var(--olive)' : 'color:var(--terracota)'}">${status}</span></td>
                  <td>${status === 'pago' ? (contaPagante ? formatConta(contaPagante) : '-') + (statusDoc.valorPago !== undefined ? ` (${formatBRL(statusDoc.valorPago)})` : '') : '-'}</td>
                  <td>
                    ${status === 'pago'
                      ? `<button class="btn-ghost" data-reabrir="${t.id}">Reabrir</button>`
                      : `<button class="btn" data-pagar="${t.id}">Marcar como pago</button>`
                    }
                    <button class="btn-ghost" data-editar="${t.id}">Editar</button>
                    <button class="btn-danger" data-del="${t.id}">Remover</button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        `;

      listaEl.querySelectorAll('[data-pagar]').forEach(btn => {
        btn.addEventListener('click', () => {
          const template = templates.find(t => t.id === btn.dataset.pagar);
          abrirModalBaixa(template, contas);
        });
      });

      listaEl.querySelectorAll('[data-reabrir]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const templateId = btn.dataset.reabrir;
          const statusDoc = statusDocs.find(s => s.templateId === templateId && s.mes === mes);
          if (statusDoc) {
            const valorEstornar = statusDoc.valorPago !== undefined ? statusDoc.valorPago : templates.find(t => t.id === templateId)?.valor || 0;
            if (statusDoc.contaPagamentoId) {
              await ajustarSaldoConta(statusDoc.contaPagamentoId, valorEstornar);
            }
            await deleteDoc(doc(db, 'contasFixasStatus', statusDoc.id));
          }
        });
      });

      listaEl.querySelectorAll('[data-editar]').forEach(btn => {
        btn.addEventListener('click', () => {
          const t = templates.find(x => x.id === btn.dataset.editar);
          editandoId = t.id;
          document.getElementById('form-cf-body').classList.remove('collapsed');
          document.getElementById('cf-editando-aviso').style.display = 'block';
          document.getElementById('cf-editando-aviso').textContent = `Editando: ${t.nome}`;
          document.getElementById('btn-cancelar-cf').style.display = 'inline-block';
          document.getElementById('btn-add-cf').textContent = 'Atualizar conta fixa';
          document.getElementById('cf-nome').value = t.nome;
          document.getElementById('cf-valor').value = t.valor;
          document.getElementById('cf-vencimento').value = t.diaVencimento || '';
          document.getElementById('cf-recorrente').value = t.recorrente ? 'sim' : 'nao';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });

      listaEl.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('Remover esta conta fixa? O histórico de meses pagos também será perdido.')) {
            await deleteDoc(doc(db, 'contasFixas', btn.dataset.del));
          }
        });
      });
    }

    unsubTemplates = onSnapshot(query(contasFixasCol), (snap) => {
      latestTemplates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    });
    unsubStatus = onSnapshot(query(statusCol), (snap) => {
      latestStatus = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      render();
    });
    unsubs.push(() => { if (unsubTemplates) unsubTemplates(); if (unsubStatus) unsubStatus(); });
  }

  function abrirModalBaixa(template, contas) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box">
        <h3>Confirmar pagamento</h3>
        <p style="color:var(--text-dim); font-size:13px; margin-top:-8px; margin-bottom:16px">${template.nome} — referência de ${mes}</p>
        <label>Conta de saída</label>
        <select id="modal-conta-pagamento">
          <option value="">Selecione a conta</option>
          ${contas.map(cc => `<option value="${cc.id}">${formatConta(cc)}</option>`).join('')}
        </select>
        <label>Valor pago</label>
        <input type="number" step="0.01" id="modal-valor-pago" value="${template.valor}">
        <div id="modal-aviso-saldo"></div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:16px">
          <button class="btn-ghost" id="modal-cancelar">Cancelar</button>
          <button class="btn" id="modal-confirmar">Confirmar pagamento</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const fechar = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) fechar(); });
    overlay.querySelector('#modal-cancelar').addEventListener('click', fechar);

    overlay.querySelector('#modal-confirmar').addEventListener('click', async () => {
      const contaId = overlay.querySelector('#modal-conta-pagamento').value;
      const valorPago = parseFloat(overlay.querySelector('#modal-valor-pago').value) || 0;
      if (!contaId) { alert('Selecione de qual conta saiu o pagamento.'); return; }
      await addDoc(statusCol, { templateId: template.id, mes, status: 'pago', contaPagamentoId: contaId, valorPago });
      const novoSaldo = await ajustarSaldoConta(contaId, -valorPago);
      if (novoSaldo !== null && novoSaldo < 0) {
        alert('Pagamento confirmado. Atenção: o saldo dessa conta ficou negativo.');
      }
      fechar();
    });
  }

  carregarLista();
  return unsubs;
}
