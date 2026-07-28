import { auth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from './firebase-config.js';

import { renderDashboard } from './modules/dashboard.js';
import { renderContasFixas } from './modules/contasFixas.js';
import { renderMercado } from './modules/mercado.js';
import { renderCartao } from './modules/cartao.js';
import { renderRenda } from './modules/renda.js';

const loginScreen = document.getElementById('login-screen');
const appShell = document.getElementById('app-shell');
const mainContent = document.getElementById('main-content');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

const modules = {
  dashboard: renderDashboard,
  contasFixas: renderContasFixas,
  mercado: renderMercado,
  cartao: renderCartao,
  renda: renderRenda
};

let currentModule = 'dashboard';
let currentUnsubscribers = [];

function cleanupModule() {
  currentUnsubscribers.forEach(fn => { try { fn(); } catch (e) {} });
  currentUnsubscribers = [];
}

async function loadModule(name) {
  cleanupModule();
  currentModule = name;
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.module === name);
  });
  mainContent.innerHTML = '<p style="color:#A5A9B3">Carregando...</p>';
  const renderFn = modules[name];
  const unsubs = await renderFn(mainContent);
  if (Array.isArray(unsubs)) currentUnsubscribers = unsubs;
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', () => loadModule(el.dataset.module));
});

document.getElementById('logout-btn').addEventListener('click', () => {
  cleanupModule();
  signOut(auth);
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    loginError.textContent = 'E-mail ou senha inválidos.';
    loginError.style.display = 'block';
  }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    loginScreen.style.display = 'none';
    appShell.classList.add('active');
    loadModule(currentModule);
  } else {
    cleanupModule();
    appShell.classList.remove('active');
    loginScreen.style.display = 'flex';
  }
});
