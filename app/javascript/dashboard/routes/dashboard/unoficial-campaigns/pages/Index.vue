<script setup>
import { onMounted, ref, computed } from 'vue';
import CampaignPopup from './CampaignPopup.vue';
import Button from 'dashboard/components-next/button/Button.vue';
const N8N_API_KEY = 'AHAIKD@O99834';
const showPopup = ref(false);
const popupMode = ref('create');
const popupId = ref(null);
const searchQuery = ref('');
// Popup de confirmação de exclusão
const showConfirmPopup = ref(false);
const deleteId = ref(null);
function openCreatePopup() {
  popupMode.value = 'create';
  popupId.value = null;
  showPopup.value = true;
}
function openEditPopup(id) {
  popupMode.value = 'edit';
  popupId.value = id;
  showPopup.value = true;
}
function closePopup() {
  showPopup.value = false;
}
function openConfirmDeletePopup(id) {
  deleteId.value = id;
  showConfirmPopup.value = true;
}
function closeConfirmPopup() {
  showConfirmPopup.value = false;
}
function onPopupSaved() {
  showPopup.value = false;
  loadCampanhas();
}
const state = ref({
  campanhas: []
});
// Funções de UI
function showAlert(targetId, type, msg) {
  const node = document.getElementById(targetId);
  if (node) {
    node.hidden = false;
    const baseClass = 'px-4 py-2 rounded-lg text-sm border';
    if (type === 'ok' || type === 'good') {
      node.className = `${baseClass} bg-n-teal-1 border-n-teal-6 text-n-teal-11`;
    } else {
      node.className = `${baseClass} bg-n-ruby-1 border-n-ruby-6 text-n-ruby-11`;
    }
    node.textContent = msg;
  }
}
function hideAlert(targetId) {
  const node = document.getElementById(targetId);
  if (node) {
    node.hidden = true;
    node.className = '';
    node.textContent = '';
  }
}
// Funções de Dados
function filterCampanhas(list, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return list;
  return list.filter((c) => String(c.nome || '').toLowerCase().includes(q));
}
function n8nNormalizarDados(row) {
  let listaContato = row.lista_contato;
  if (typeof listaContato === 'string') {
    try {
      listaContato = JSON.parse(listaContato);
    } catch {
      listaContato = [];
    }
  }
  return {
    ...row,
    lista_contato: Array.isArray(listaContato) ? listaContato : [],
    dias_semana: Array.isArray(row.dias_semana) ? row.dias_semana : [],
  };
}
// Computed para a tabela filtrada
const filteredCampanhas = computed(() => {
  return filterCampanhas(state.value.campanhas, searchQuery.value);
});
// Formatador de data para o período
function formatPeriod(campaign) {
  const ini = campaign.dt_inicio ? new Date(campaign.dt_inicio).toLocaleString() : '-';
  const fim = campaign.dt_fim ? new Date(campaign.dt_fim).toLocaleString() : '-';
  return `${ini} → ${fim}`;
}
// Funções de API
async function n8nRequest(method, url, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: N8N_API_KEY,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = null;
  const text = await res.text();
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error || res.statusText}`);
  return data;
}
async function loadCampanhas() {
  hideAlert('alertList');
  try {
    const data = await n8nRequest('GET', 'https://iara.impulsocore.com.br/n8n/webhook/campanha');
    const rows = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    state.value.campanhas = rows.map(n8nNormalizarDados);
  } catch (err) {
    showAlert('alertList', 'bad', err.message || 'Erro ao carregar.');
  }
}
// Função para excluir campanha
async function executeDelete() {
  hideAlert('alertList');
  if (!deleteId.value) return;
  
  try {
    await n8nRequest('DELETE', `https://iara.impulsocore.com.br/n8n/webhook/eeb42db5-630e-44ff-a439-ab8ce2418dba/campanha/${deleteId.value}`);
    showConfirmPopup.value = false;
    await loadCampanhas();
  } catch (err) {
    showAlert('alertList', 'bad', err.message || 'Erro ao excluir.');
  }
}
onMounted(() => {
  loadCampanhas();
});
</script>
<template>
  <div class="flex flex-col min-h-screen w-[1000px] max-w-full mx-auto bg-n-solid-2 px-0 py-0">
    <div class="w-full flex-1">
      <div class="bg-n-solid-1 border border-n-weak rounded-none md:rounded-xl overflow-hidden min-h-screen w-full h-full" style="width: 1000px;">
        <!-- Header -->
        <div class="flex items-center justify-between p-6 border-b border-n-weak">
          <div>
            <h2 class="text-lg font-semibold text-n-slate-12 mb-1">Campanhas Não Oficiais</h2>
            <p class="text-sm text-n-slate-11">Lista campanhas não oficiais ativas</p>
          </div>
          <div class="flex gap-2">
            <Button
              id="btnReload"
              label="Atualizar"
              slate
              faded
              @click="loadCampanhas"
            />
            <Button
              id="btnOpenCreate"
              icon="i-lucide-plus"
              label="Criar Campanha"
              @click="openCreatePopup"
            />
          </div>
        </div>
        <!-- Search -->
        <div class="p-4 border-b border-n-weak bg-n-solid-2">
          <input
            id="search"
            v-model="searchQuery"
            type="search"
            placeholder="Buscar por nome..."
            class="w-full px-3 py-2 text-sm bg-n-solid-1 border border-n-weak rounded-lg text-n-slate-12 placeholder:text-n-slate-10 focus:outline-none focus:ring-2 focus:ring-n-blue-border focus:border-transparent"
          />
        </div>
        <!-- Table -->
        <div class="overflow-x-auto w-full" style="width: 100%;">
          <table class="min-w-full divide-y divide-n-weak">
            <thead class="bg-n-solid-2">
              <tr>
                <th class="py-3 px-4 text-left text-xs font-semibold text-n-slate-11 uppercase tracking-wider">ID</th>
                <th class="py-3 px-4 text-left text-xs font-semibold text-n-slate-11 uppercase tracking-wider">Nome</th>
                <th class="py-3 px-4 text-left text-xs font-semibold text-n-slate-11 uppercase tracking-wider">Horário</th>
                <th class="py-3 px-4 text-left text-xs font-semibold text-n-slate-11 uppercase tracking-wider">Período</th>
                <th class="py-3 px-4 text-right text-xs font-semibold text-n-slate-11 uppercase tracking-wider">Ações</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-n-weak bg-n-solid-1">
              <tr v-for="c in filteredCampanhas" :key="c.id">
                <td class="py-3 px-4 text-sm text-n-slate-12">{{ c.id ?? '-' }}</td>
                <td class="py-3 px-4 text-sm text-n-slate-12">{{ c.nome ?? '-' }}</td>
                <td class="py-3 px-4 text-sm text-n-slate-12">{{ c.horario_disparo ?? '-' }}</td>
                <td class="py-3 px-4 text-sm text-n-slate-11">{{ formatPeriod(c) }}</td>
                <td class="py-3 px-4 text-right">
                  <div class="flex gap-2 justify-end">
                    <button
                      type="button"
                      class="px-3 py-1.5 text-xs font-medium text-n-slate-12 bg-n-solid-2 border border-n-weak rounded-lg hover:bg-n-solid-3 transition-colors"
                      @click="openEditPopup(c.id)"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      class="px-3 py-1.5 text-xs font-medium text-n-ruby-11 bg-n-ruby-1 border border-n-ruby-6 rounded-lg hover:bg-n-ruby-2 transition-colors"
                      @click="openConfirmDeletePopup(c.id)"
                    >
                      Excluir
                    </button>
                  </div>
                </td>
              </tr>
              <tr v-if="filteredCampanhas.length === 0">
                <td colspan="5" class="py-6 px-4 text-center text-sm text-n-slate-11">
                  Nenhuma campanha encontrada
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- Footer -->
        <div class="p-4 bg-n-solid-2 border-t border-n-weak flex items-center justify-between">
          <div class="text-xs text-n-slate-11">{{ filteredCampanhas.length }} campanha(s) exibida(s)</div>
          <div id="alertList" hidden class="text-sm"></div>
        </div>
      </div>
    </div>
    <!-- Popup de Campanha -->
    <CampaignPopup
      :show="showPopup"
      :mode="popupMode"
      :campaign-id="popupId"
      @close="closePopup"
      @saved="onPopupSaved"
    />
    <!-- Popup de Confirmação de Exclusão -->
    <teleport to="body">
      <div v-if="showConfirmPopup" class="fixed inset-0 z-50 flex items-center justify-center p-3">
        <div class="absolute inset-0 bg-n-solid-12/50 backdrop-blur-sm" @click="closeConfirmPopup" />
        <div class="relative w-full max-w-md rounded-xl border border-n-weak bg-n-solid-1 shadow-xl">
          <div class="flex flex-col p-5">
            <header class="flex items-center justify-between pb-3">
              <h2 class="text-lg font-semibold text-n-slate-12">Confirmar Exclusão</h2>
              <button
                type="button"
                class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-n-weak text-n-slate-11 transition hover:bg-n-solid-3"
                @click="closeConfirmPopup"
              >
                ✕
              </button>
            </header>
            <div class="py-4">
              <p class="text-sm text-n-slate-12 mb-2">
                Tem certeza que deseja excluir a campanha <span class="font-medium">{{ deleteId }}</span>?
              </p>
              <p class="text-sm text-n-ruby-11">
                Esta operação não pode ser desfeita.
              </p>
            </div>
            <footer class="flex justify-end gap-3 pt-3">
              <button
                type="button"
                class="inline-flex items-center justify-center gap-2 rounded-lg border border-n-weak bg-n-solid-1 px-4 py-2.5 text-sm font-medium text-n-slate-12 transition hover:bg-n-solid-3"
                @click="closeConfirmPopup"
              >
                Cancelar
              </button>
              <button
                type="button"
                class="inline-flex items-center justify-center gap-2 rounded-lg bg-n-ruby-9 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-n-ruby-10"
                @click="executeDelete"
              >
                Excluir
              </button>
            </footer>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>
