import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import { formatBRL, formatDate, todayISO, currentMonthRef, formatConta, collapsibleHeaderHTML, wireCollapsible } from '../helpers.js';
import { ajustarSaldoConta } from '../saldoService.js';

const contasCol = collection(db, 'contasBancarias');
const rendaCol = collection(db, 'rendaMensal');
const reservasCol = collection(db, 'reservas');

export async function getContas() {
  return new Promise((resolve) => {
    const unsub = onSnapshot(contasCol, (snap) => {
      resolve(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      unsub();
    });
  });
}

export function renderRenda(container) {
  const unsubs = [];

  container.innerHTML = `
    <h2 class="module-title">Renda e Reservas</h2>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-conta-body', 'Contas cadastradas')}
      <div id="form-conta-body" class="collapsible-body collapsed">
        <form id="form-conta" class="grid grid-4" style="margin-top:12px">
          <div>
            <label>Pessoa</label>
            <select id="conta-pessoa" required>
              <option value="Natasha">Natasha</option>
              <option value="Daniel">Daniel</option>
            </select>
          </div>
          <div>
            <label>Tipo</label>
            <select id="conta-tipo" required>
              <option value="PF">PF</option>
              <option value="PJ">PJ</option>
            </select>
          </div>
          <div>
            <label>Nome/Banco</label>
            <input type="text" id="conta-nome" placeholder="Ex: Nubank">
          </div>
          <div>
            <label>Saldo inicial / atual</label>
            <input type="number" step="0.01" id="conta-saldo-inicial" placeholder="0,00">
          </div>
        </form>
        <button class="btn" id="btn-add-conta">Adicionar conta</button>
        <div id="lista-contas" style="margin-top:20px"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-renda-body', 'Renda do mês')}
      <div id="form-renda-body" class="collapsible-body collapsed">
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Referência: ${currentMonthRef()}</p>
        <div id="renda-form-area"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-reserva-body', 'Caixas de reserva')}
      <div id="form-reserva-body" class="collapsible-body collapsed">
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Cada pessoa pode ter várias caixas de reserva cadastradas separadamente.</p>
        <div class="grid grid-3" style="margin-top:12px">
          <div><label>Pessoa</label>
            <select id="reserva-pessoa"><option>Natasha</option><option>Daniel</option></select>
          </div>
          <div><label>Nome da caixa</label><input type="text" id="reserva-nome" placeholder="Ex: Reserva de emergência"></div>
          <div><label>Valor atual guardado</label><input type="number" step="0.01" id="reserva-valor"></div>
        </div>
        <button class="btn" id="btn-add-reserva">Adicionar caixa de reserva</button>
        <div id="lista-reservas" style="margin-top:20px"></div>
      </div>
    </div>

    <div class="card">
      <h3>Resumo</h3>
      <div id="reserva-resumo" class="grid grid-3" style="margin-top:12px"></div>
    </div>
  `;
  wireCollapsible(container);

  document.getElementById('btn-add-conta').addEventListener('click', async () => {
    const pessoa = document.getElementById('conta-pessoa').value;
    const tipo = document.getElementById('conta-tipo').value;
    const nome = document.getElementById('conta-nome').value || `${pessoa} ${tipo}`;
    const saldoInicial = parseFloat(document.getElementById('conta-saldo-inicial').value) || 0;
    await addDoc(contasCol, { pessoa, tipo, nome, saldoAtual: saldoInicial, saldoAtualizadoEm: todayISO() });
    document.getElementById('conta-nome').value = '';
    document.getElementById('conta-saldo-inicial').value = '';
  });

  document.getElementById('btn-add-reserva').addEventListener('click', async () => {
    const nome = document.getElementById('reserva-nome').value;
    if (!nome) return;
    await addDoc(reservasCol, {
      pessoa: document.getElementById('reserva-pessoa').value,
      nome,
      valorAtual: parseFloat(document.getElementById('reserva-valor').value) || 0
    });
    document.getElementById('reserva-nome').value = '';
    document.getElementById('reserva-valor').value = '';
  });

  let contasAtuais = [];
  let reservasAtuais = [];

  const unsubContas = onSnapshot(contasCol, (snap) => {
    contasAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaContas(contasAtuais);
    renderRendaForm(contasAtuais);
    renderResumo();
  });
  unsubs.push(unsubContas);

  const unsubReservas = onSnapshot(reservasCol, (snap) => {
    reservasAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaReservas(reservasAtuais);
    renderResumo();
  });
  unsubs.push(unsubReservas);

  function renderListaContas(contas) {
    const el = document.getElementById('lista-contas');
    if (!contas.length) {
      el.innerHTML = '<div class="empty-state">Nenhuma conta cadastrada ainda.</div>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Conta</th><th>Saldo atual</th><th>Atualizado em</th><th></th></tr></thead>
        <tbody>
          ${contas.map(c => `
            <tr>
              <td>${formatConta(c)}</td>
              <td>
                <input type="number" step="0.01" data-conta-id="${c.id}" class="input-saldo" value="${c.saldoAtual || 0}" style="margin-bottom:0; width:120px">
              </td>
              <td>${formatDate(c.saldoAtualizadoEm)}</td>
              <td><button class="btn-danger" data-del-conta="${c.id}">Remover</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    el.querySelectorAll('.input-saldo').forEach(inp => {
      inp.addEventListener('change', async () => {
        await updateDoc(doc(db, 'contasBancarias', inp.dataset.contaId), {
          saldoAtual: parseFloat(inp.value) || 0,
          saldoAtualizadoEm: todayISO()
        });
      });
    });
    el.querySelectorAll('[data-del-conta]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esta conta?')) await deleteDoc(doc(db, 'contasBancarias', btn.dataset.delConta));
      });
    });
  }

  function renderListaReservas(reservas) {
    const el = document.getElementById('lista-reservas');
    if (!reservas.length) {
      el.innerHTML = '<div class="empty-state">Nenhuma caixa de reserva cadastrada ainda.</div>';
      return;
    }
    el.innerHTML = `
      <table>
        <thead><tr><th>Pessoa</th><th>Caixa</th><th>Valor atual</th><th></th></tr></thead>
        <tbody>
          ${reservas.map(r => `
            <tr>
              <td>${r.pessoa}</td>
              <td>${r.nome}</td>
              <td><input type="number" step="0.01" data-reserva-id="${r.id}" class="input-reserva-valor" value="${r.valorAtual || 0}" style="margin-bottom:0; width:120px"></td>
              <td><button class="btn-danger" data-del-reserva="${r.id}">Remover</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    el.querySelectorAll('.input-reserva-valor').forEach(inp => {
      inp.addEventListener('change', async () => {
        await updateDoc(doc(db, 'reservas', inp.dataset.reservaId), { valorAtual: parseFloat(inp.value) || 0 });
      });
    });
    el.querySelectorAll('[data-del-reserva]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esta caixa de reserva?')) await deleteDoc(doc(db, 'reservas', btn.dataset.delReserva));
      });
    });
  }

  function renderRendaForm(contas) {
    const el = document.getElementById('renda-form-area');
    if (!contas.length) {
      el.innerHTML = '<div class="empty-state">Cadastre uma conta primeiro para lançar renda.</div>';
      return;
    }
    const mes = currentMonthRef();
    el.innerHTML = `
      <table>
        <thead><tr><th>Conta</th><th>Renda do mês</th></tr></thead>
        <tbody>
          ${contas.map(c => `
            <tr>
              <td>${formatConta(c)}</td>
              <td><input type="number" step="0.01" class="input-renda" data-conta-id="${c.id}" style="margin-bottom:0; width:140px" placeholder="0,00"></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    (async () => {
      const snap = await new Promise(res => { const u = onSnapshot(query(rendaCol), s => { res(s); u(); }); });
      contas.forEach((c) => {
        const existing = snap.docs.find(d => d.data().contaId === c.id && d.data().mes === mes);
        if (existing) {
          const input = el.querySelector(`.input-renda[data-conta-id="${c.id}"]`);
          if (input) input.value = existing.data().valor;
        }
      });
    })();

    el.querySelectorAll('.input-renda').forEach(inp => {
      inp.addEventListener('change', async () => {
        const valorNovo = parseFloat(inp.value) || 0;
        const contaId = inp.dataset.contaId;
        const snap = await new Promise(res => { const u = onSnapshot(query(rendaCol), s => { res(s); u(); }); });
        const existing = snap.docs.find(d => d.data().contaId === contaId && d.data().mes === mes);
        const valorAntigo = existing ? (existing.data().valor || 0) : 0;
        const diferenca = valorNovo - valorAntigo;

        if (existing) {
          await updateDoc(doc(db, 'rendaMensal', existing.id), { valor: valorNovo });
        } else {
          await addDoc(collection(db, 'rendaMensal'), { contaId, mes, valor: valorNovo });
        }
        await ajustarSaldoConta(contaId, diferenca);
        renderResumo();
      });
    });
  }

  async function renderResumo() {
    const el = document.getElementById('reserva-resumo');
    const mes = currentMonthRef();
    const snap = await new Promise(res => { const u = onSnapshot(query(rendaCol), s => { res(s); u(); }); });
    const rendasMes = snap.docs.map(d => d.data()).filter(r => r.mes === mes);
    const totalRenda = rendasMes.reduce((s, r) => s + (r.valor || 0), 0);
    const totalSaldo = contasAtuais.reduce((s, c) => s + (c.saldoAtual || 0), 0);

    const totalNatasha = reservasAtuais.filter(r => r.pessoa === 'Natasha').reduce((s, r) => s + (r.valorAtual || 0), 0);
    const totalDaniel = reservasAtuais.filter(r => r.pessoa === 'Daniel').reduce((s, r) => s + (r.valorAtual || 0), 0);
    const totalReservaGeral = totalNatasha + totalDaniel;

    el.innerHTML = `
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalRenda)}</div>
        <div class="label">Renda total do casal (mês)</div>
      </div>
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalSaldo)}</div>
        <div class="label">Saldo somado em contas</div>
      </div>
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalReservaGeral)}</div>
        <div class="label">Total geral em reservas</div>
      </div>
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalNatasha)}</div>
        <div class="label">Reservas de Natasha</div>
      </div>
      <div class="ledger-figure">
        <div class="value">${formatBRL(totalDaniel)}</div>
        <div class="label">Reservas de Daniel</div>
      </div>
    `;
  }

  return unsubs;
}
