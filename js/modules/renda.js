import { db, collection, addDoc, updateDoc, deleteDoc, doc, onSnapshot, query } from '../firebase-config.js';
import {
  formatBRL, formatDate, todayISO, currentMonthRef, monthRefFromDate,
  monthPickerHTML, wireMonthPicker, formatConta, collapsibleHeaderHTML, wireCollapsible
} from '../helpers.js';
import { ajustarSaldoConta } from '../saldoService.js';

const contasCol = collection(db, 'contasBancarias');
const entradasCol = collection(db, 'entradas');
const reservasCol = collection(db, 'reservas');
const receitasRecorrentesCol = collection(db, 'receitasRecorrentes');
const receitasRecorrentesStatusCol = collection(db, 'receitasRecorrentesStatus');

export async function getReceitasRecorrentes() {
  return new Promise((resolve) => {
    const unsub = onSnapshot(receitasRecorrentesCol, (snap) => {
      resolve(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      unsub();
    });
  });
}

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
  let mes = currentMonthRef();
  let editandoEntradaId = null;
  let edicaoEntradaOriginal = null;

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
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-conta" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-conta">Adicionar conta</button>
        </div>
        <div id="lista-contas" style="margin-top:20px"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-entrada-body', 'Entradas')}
      <div id="form-entrada-body" class="collapsible-body collapsed">
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Cada entrada lançada soma automaticamente ao saldo da conta escolhida. Se preferir, você também pode só ajustar o "Saldo atual" direto na tabela de contas acima, sem detalhar a origem.</p>
        <div id="entrada-editando-aviso" style="display:none; color:var(--gold); font-size:13px; margin-bottom:10px"></div>
        <div class="grid grid-4" style="margin-top:12px">
          <div><label>Data</label><input type="date" id="entrada-data" value="${todayISO()}"></div>
          <div><label>Conta</label><select id="entrada-conta"></select></div>
          <div><label>Valor</label><input type="number" step="0.01" id="entrada-valor"></div>
          <div><label>Descrição (opcional)</label><input type="text" id="entrada-descricao" placeholder="Ex: Salário, Freela"></div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-entrada" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-entrada">Adicionar entrada</button>
        </div>
        <div id="mp-slot-entrada" style="margin-top:20px">${monthPickerHTML(mes)}</div>
        <div id="lista-entradas" style="margin-top:12px"></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:24px">
      ${collapsibleHeaderHTML('form-receita-rec-body', 'Receitas recorrentes')}
      <div id="form-receita-rec-body" class="collapsible-body collapsed">
        <p style="color:var(--text-dim); font-size:13px; margin-top:0">Usadas na Projeção Financeira do Dashboard. Marque como "recebida" no mês em que o valor já entrou (lançado em Entradas), pra não contar duas vezes.</p>
        <div class="grid grid-3" style="margin-top:12px">
          <div><label>Nome</label><input type="text" id="receita-rec-nome" placeholder="Ex: Salário Natasha"></div>
          <div><label>Valor mensal</label><input type="number" step="0.01" id="receita-rec-valor"></div>
          <div><label>Conta de destino</label><select id="receita-rec-conta"></select></div>
        </div>
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-receita-rec" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-receita-rec">Adicionar receita recorrente</button>
        </div>
        <div id="mp-slot-receita-rec" style="margin-top:20px">${monthPickerHTML(currentMonthRef(), 'mprec')}</div>
        <div id="lista-receitas-rec" style="margin-top:12px"></div>
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
        <div style="display:flex; gap:8px">
          <button class="btn-ghost" id="btn-cancelar-reserva" style="display:none">Cancelar edição</button>
          <button class="btn" id="btn-add-reserva">Adicionar caixa de reserva</button>
        </div>
        <div id="lista-reservas" style="margin-top:20px"></div>
      </div>
    </div>

    <div class="card">
      <h3>Resumo</h3>
      <div id="reserva-resumo" class="grid grid-3" style="margin-top:12px"></div>
    </div>
  `;
  wireCollapsible(container);

  function refreshMonthPicker() {
    document.getElementById('mp-slot-entrada').innerHTML = monthPickerHTML(mes);
    wireMonthPicker('mp', mes, (novoMes) => { mes = novoMes; refreshMonthPicker(); carregarEntradas(); });
  }

  let editandoContaId = null;
  function resetFormConta() {
    editandoContaId = null;
    document.getElementById('btn-cancelar-conta').style.display = 'none';
    document.getElementById('btn-add-conta').textContent = 'Adicionar conta';
    document.getElementById('conta-nome').value = '';
    document.getElementById('conta-saldo-inicial').value = '';
  }
  document.getElementById('btn-cancelar-conta').addEventListener('click', resetFormConta);

  document.getElementById('btn-add-conta').addEventListener('click', async () => {
    const pessoa = document.getElementById('conta-pessoa').value;
    const tipo = document.getElementById('conta-tipo').value;
    const nome = document.getElementById('conta-nome').value || `${pessoa} ${tipo}`;
    if (editandoContaId) {
      await updateDoc(doc(db, 'contasBancarias', editandoContaId), { pessoa, tipo, nome });
    } else {
      const saldoInicial = parseFloat(document.getElementById('conta-saldo-inicial').value) || 0;
      await addDoc(contasCol, { pessoa, tipo, nome, saldoAtual: saldoInicial, saldoAtualizadoEm: todayISO() });
    }
    resetFormConta();
  });

  let editandoReservaId = null;
  function resetFormReserva() {
    editandoReservaId = null;
    document.getElementById('btn-cancelar-reserva').style.display = 'none';
    document.getElementById('btn-add-reserva').textContent = 'Adicionar caixa de reserva';
    document.getElementById('reserva-nome').value = '';
    document.getElementById('reserva-valor').value = '';
  }
  document.getElementById('btn-cancelar-reserva').addEventListener('click', resetFormReserva);

  document.getElementById('btn-add-reserva').addEventListener('click', async () => {
    const nome = document.getElementById('reserva-nome').value;
    if (!nome) return;
    const payload = {
      pessoa: document.getElementById('reserva-pessoa').value,
      nome,
      valorAtual: parseFloat(document.getElementById('reserva-valor').value) || 0
    };
    if (editandoReservaId) {
      await updateDoc(doc(db, 'reservas', editandoReservaId), payload);
    } else {
      await addDoc(reservasCol, payload);
    }
    resetFormReserva();
  });

  function resetFormEntrada() {
    editandoEntradaId = null;
    edicaoEntradaOriginal = null;
    document.getElementById('entrada-editando-aviso').style.display = 'none';
    document.getElementById('btn-cancelar-entrada').style.display = 'none';
    document.getElementById('btn-add-entrada').textContent = 'Adicionar entrada';
    document.getElementById('entrada-data').value = todayISO();
    document.getElementById('entrada-valor').value = '';
    document.getElementById('entrada-descricao').value = '';
  }
  document.getElementById('btn-cancelar-entrada').addEventListener('click', resetFormEntrada);

  document.getElementById('btn-add-entrada').addEventListener('click', async () => {
    const contaId = document.getElementById('entrada-conta').value;
    const valor = parseFloat(document.getElementById('entrada-valor').value) || 0;
    if (!contaId) { alert('Selecione a conta.'); return; }
    if (!valor) { alert('Informe o valor da entrada.'); return; }
    const payload = {
      data: document.getElementById('entrada-data').value,
      contaId,
      valor,
      descricao: document.getElementById('entrada-descricao').value || ''
    };

    if (editandoEntradaId) {
      await updateDoc(doc(db, 'entradas', editandoEntradaId), payload);
      if (edicaoEntradaOriginal) {
        await ajustarSaldoConta(edicaoEntradaOriginal.contaId, -edicaoEntradaOriginal.valor);
      }
    } else {
      await addDoc(entradasCol, payload);
    }
    await ajustarSaldoConta(contaId, payload.valor);
    resetFormEntrada();
  });

  let mesRec = currentMonthRef();
  function refreshMonthPickerRec() {
    document.getElementById('mp-slot-receita-rec').innerHTML = monthPickerHTML(mesRec, 'mprec');
    wireMonthPicker('mprec', mesRec, (novoMes) => { mesRec = novoMes; refreshMonthPickerRec(); renderListaReceitasRec(receitasRecAtuais); });
  }
  refreshMonthPickerRec();

  let editandoReceitaRecId = null;
  function resetFormReceitaRec() {
    editandoReceitaRecId = null;
    document.getElementById('btn-cancelar-receita-rec').style.display = 'none';
    document.getElementById('btn-add-receita-rec').textContent = 'Adicionar receita recorrente';
    document.getElementById('receita-rec-nome').value = '';
    document.getElementById('receita-rec-valor').value = '';
  }
  document.getElementById('btn-cancelar-receita-rec').addEventListener('click', resetFormReceitaRec);

  document.getElementById('btn-add-receita-rec').addEventListener('click', async () => {
    const nome = document.getElementById('receita-rec-nome').value;
    const valor = parseFloat(document.getElementById('receita-rec-valor').value) || 0;
    const contaId = document.getElementById('receita-rec-conta').value;
    if (!nome || !valor) { alert('Preencha nome e valor.'); return; }
    const payload = { nome, valor, contaId: contaId || null };
    if (editandoReceitaRecId) {
      await updateDoc(doc(db, 'receitasRecorrentes', editandoReceitaRecId), payload);
    } else {
      await addDoc(receitasRecorrentesCol, payload);
    }
    resetFormReceitaRec();
  });

  function renderListaReceitasRec(receitas) {
    const el = document.getElementById('lista-receitas-rec');
    if (!receitas.length) {
      el.innerHTML = '<div class="empty-state">Nenhuma receita recorrente cadastrada ainda.</div>';
      return;
    }
    const total = receitas.reduce((s, r) => s + (r.valor || 0), 0);
    el.innerHTML = `
      <div class="ledger-figure" style="margin-bottom:12px"><div class="value">${formatBRL(total)}</div><div class="label">Total mensal previsto</div></div>
      <table>
        <thead><tr><th>Nome</th><th>Valor mensal</th><th>Conta</th><th>Status (${mesRec})</th><th></th></tr></thead>
        <tbody>
          ${receitas.map(r => {
            const conta = contasAtuais.find(c => c.id === r.contaId);
            const statusDoc = statusReceitasRecAtuais.find(s => s.receitaId === r.id && s.mes === mesRec);
            const recebida = !!statusDoc;
            return `
            <tr>
              <td>${r.nome}</td>
              <td>${formatBRL(r.valor)}</td>
              <td>${conta ? formatConta(conta) : '-'}</td>
              <td><span class="tag" style="color:${recebida ? 'var(--olive)' : 'var(--terracota)'}">${recebida ? 'recebida' : 'pendente'}</span></td>
              <td>
                ${recebida
                  ? `<button class="btn-ghost" data-desmarcar-receita-rec="${r.id}">Desmarcar</button>`
                  : `<button class="btn" data-marcar-receita-rec="${r.id}">Marcar como recebida</button>`
                }
                <button class="btn-ghost" data-editar-receita-rec="${r.id}">Editar</button>
                <button class="btn-danger" data-del-receita-rec="${r.id}">Remover</button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
    el.querySelectorAll('[data-marcar-receita-rec]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await addDoc(receitasRecorrentesStatusCol, { receitaId: btn.dataset.marcarReceitaRec, mes: mesRec });
      });
    });
    el.querySelectorAll('[data-desmarcar-receita-rec]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const statusDoc = statusReceitasRecAtuais.find(s => s.receitaId === btn.dataset.desmarcarReceitaRec && s.mes === mesRec);
        if (statusDoc) await deleteDoc(doc(db, 'receitasRecorrentesStatus', statusDoc.id));
      });
    });
    el.querySelectorAll('[data-editar-receita-rec]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = receitas.find(x => x.id === btn.dataset.editarReceitaRec);
        editandoReceitaRecId = r.id;
        document.getElementById('form-receita-rec-body').classList.remove('collapsed');
        document.getElementById('btn-cancelar-receita-rec').style.display = 'inline-block';
        document.getElementById('btn-add-receita-rec').textContent = 'Atualizar receita recorrente';
        document.getElementById('receita-rec-nome').value = r.nome;
        document.getElementById('receita-rec-valor').value = r.valor;
        if (r.contaId) document.getElementById('receita-rec-conta').value = r.contaId;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    el.querySelectorAll('[data-del-receita-rec]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esta receita recorrente?')) await deleteDoc(doc(db, 'receitasRecorrentes', btn.dataset.delReceitaRec));
      });
    });
  }

  let receitasRecAtuais = [];
  let statusReceitasRecAtuais = [];
  const unsubReceitasRec = onSnapshot(receitasRecorrentesCol, (snap) => {
    receitasRecAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaReceitasRec(receitasRecAtuais);
  });
  unsubs.push(unsubReceitasRec);

  const unsubStatusReceitasRec = onSnapshot(receitasRecorrentesStatusCol, (snap) => {
    statusReceitasRecAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaReceitasRec(receitasRecAtuais);
  });
  unsubs.push(unsubStatusReceitasRec);

  let contasAtuais = [];
  let reservasAtuais = [];

  const unsubContas = onSnapshot(contasCol, (snap) => {
    contasAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaContas(contasAtuais);
    preencherSelectContas(contasAtuais);
    renderResumo();
    renderListaReceitasRec(receitasRecAtuais);
  });
  unsubs.push(unsubContas);

  const unsubReservas = onSnapshot(reservasCol, (snap) => {
    reservasAtuais = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderListaReservas(reservasAtuais);
    renderResumo();
  });
  unsubs.push(unsubReservas);

  function preencherSelectContas(contas) {
    const select = document.getElementById('entrada-conta');
    const valorAtual = select.value;
    select.innerHTML = contas.map(c => `<option value="${c.id}">${formatConta(c)}</option>`).join('');
    if (valorAtual) select.value = valorAtual;

    const selectRec = document.getElementById('receita-rec-conta');
    const valorAtualRec = selectRec.value;
    selectRec.innerHTML = '<option value="">Sem conta específica</option>' + contas.map(c => `<option value="${c.id}">${formatConta(c)}</option>`).join('');
    if (valorAtualRec) selectRec.value = valorAtualRec;
  }

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
              <td>
                <button class="btn-ghost" data-editar-conta="${c.id}">Editar</button>
                <button class="btn-danger" data-del-conta="${c.id}">Remover</button>
              </td>
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
    el.querySelectorAll('[data-editar-conta]').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = contas.find(x => x.id === btn.dataset.editarConta);
        editandoContaId = c.id;
        document.getElementById('form-conta-body').classList.remove('collapsed');
        document.getElementById('btn-cancelar-conta').style.display = 'inline-block';
        document.getElementById('btn-add-conta').textContent = 'Atualizar conta';
        document.getElementById('conta-pessoa').value = c.pessoa;
        document.getElementById('conta-tipo').value = c.tipo;
        document.getElementById('conta-nome').value = c.nome;
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
              <td>
                <button class="btn-ghost" data-editar-reserva="${r.id}">Editar</button>
                <button class="btn-danger" data-del-reserva="${r.id}">Remover</button>
              </td>
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
    el.querySelectorAll('[data-editar-reserva]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = reservas.find(x => x.id === btn.dataset.editarReserva);
        editandoReservaId = r.id;
        document.getElementById('form-reserva-body').classList.remove('collapsed');
        document.getElementById('btn-cancelar-reserva').style.display = 'inline-block';
        document.getElementById('btn-add-reserva').textContent = 'Atualizar caixa de reserva';
        document.getElementById('reserva-pessoa').value = r.pessoa;
        document.getElementById('reserva-nome').value = r.nome;
        document.getElementById('reserva-valor').value = r.valorAtual;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    el.querySelectorAll('[data-del-reserva]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (confirm('Remover esta caixa de reserva?')) await deleteDoc(doc(db, 'reservas', btn.dataset.delReserva));
      });
    });
  }

  let unsubEntradas = null;
  function carregarEntradas() {
    if (unsubEntradas) unsubEntradas();
    unsubEntradas = onSnapshot(query(entradasCol), (snap) => {
      const entradas = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(e => monthRefFromDate(e.data) === mes)
        .sort((a, b) => (b.data || '').localeCompare(a.data || ''));

      const el = document.getElementById('lista-entradas');
      if (!entradas.length) {
        el.innerHTML = '<div class="empty-state">Nenhuma entrada registrada nesse mês.</div>';
        return;
      }
      const total = entradas.reduce((s, e) => s + e.valor, 0);
      el.innerHTML = `
        <div class="ledger-figure" style="margin-bottom:12px"><div class="value">${formatBRL(total)}</div><div class="label">Total de entradas em ${mes}</div></div>
        <table>
          <thead><tr><th>Data</th><th>Conta</th><th>Descrição</th><th>Valor</th><th></th></tr></thead>
          <tbody>
            ${entradas.map(e => {
              const conta = contasAtuais.find(c => c.id === e.contaId);
              return `
              <tr>
                <td>${formatDate(e.data)}</td>
                <td>${conta ? formatConta(conta) : '-'}</td>
                <td>${e.descricao || '-'}</td>
                <td>${formatBRL(e.valor)}</td>
                <td>
                  <button class="btn-ghost" data-editar-entrada="${e.id}">Editar</button>
                  <button class="btn-danger" data-del-entrada="${e.id}">Excluir</button>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      `;

      el.querySelectorAll('[data-editar-entrada]').forEach(btn => {
        btn.addEventListener('click', () => {
          const e = entradas.find(x => x.id === btn.dataset.editarEntrada);
          editandoEntradaId = e.id;
          edicaoEntradaOriginal = { contaId: e.contaId, valor: e.valor };
          document.getElementById('form-entrada-body').classList.remove('collapsed');
          document.getElementById('entrada-editando-aviso').style.display = 'block';
          document.getElementById('entrada-editando-aviso').textContent = `Editando entrada de ${formatBRL(e.valor)}`;
          document.getElementById('btn-cancelar-entrada').style.display = 'inline-block';
          document.getElementById('btn-add-entrada').textContent = 'Atualizar entrada';
          document.getElementById('entrada-data').value = e.data;
          document.getElementById('entrada-conta').value = e.contaId;
          document.getElementById('entrada-valor').value = e.valor;
          document.getElementById('entrada-descricao').value = e.descricao || '';
          window.scrollTo({ top: 0, behavior: 'smooth' });
        });
      });
      el.querySelectorAll('[data-del-entrada]').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('Excluir esta entrada? O valor será removido do saldo da conta.')) return;
          const e = entradas.find(x => x.id === btn.dataset.delEntrada);
          await ajustarSaldoConta(e.contaId, -e.valor);
          await deleteDoc(doc(db, 'entradas', e.id));
        });
      });
    });
    unsubs.push(() => { if (unsubEntradas) unsubEntradas(); });
  }

  refreshMonthPicker();
  carregarEntradas();

  async function renderResumo() {
    const el = document.getElementById('reserva-resumo');
    const totalSaldo = contasAtuais.reduce((s, c) => s + (c.saldoAtual || 0), 0);

    const totalNatasha = reservasAtuais.filter(r => r.pessoa === 'Natasha').reduce((s, r) => s + (r.valorAtual || 0), 0);
    const totalDaniel = reservasAtuais.filter(r => r.pessoa === 'Daniel').reduce((s, r) => s + (r.valorAtual || 0), 0);
    const totalReservaGeral = totalNatasha + totalDaniel;

    el.innerHTML = `
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
