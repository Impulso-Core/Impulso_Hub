<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useStore } from 'vuex';
import ApiClient from 'dashboard/api/ApiClient';
const N8N_API_KEY = 'AHAIKD@O99834';
const props = defineProps({
  show: Boolean,
  mode: { type: String, default: 'create' },
  campaignId: { type: [Number, String], default: null }
});
const emit = defineEmits(['close', 'saved']);
// Account via store (usa sessão/autenticação do dashboard)
const store = useStore();
const accountId = computed(() => store.getters.getCurrentAccountId);
// Constantes
const DAYS = [
  { key: 'Sun', label: 'Dom' },
  { key: 'Mon', label: 'Seg' },
  { key: 'Tue', label: 'Ter' },
  { key: 'Wed', label: 'Qua' },
  { key: 'Thu', label: 'Qui' },
  { key: 'Fri', label: 'Sex' },
  { key: 'Sat', label: 'Sáb' }
];
const MEDIA_TYPES = {
  image: { extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'], mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'] },
  video: { extensions: ['mp4', '3gp', 'mov', 'avi', 'mkv', 'webm'], mimeTypes: ['video/mp4', 'video/3gpp', 'video/quicktime'] },
  document: { extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx'], mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  audio: { extensions: ['mp3', 'ogg', 'wav', 'aac', 'm4a'], mimeTypes: ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac'] },
  sticker: { extensions: ['webp', 'gif'], mimeTypes: ['image/webp', 'image/gif'] }
};
// Estado
const form = ref({
  nome: '',
  mensagem: '',
  horario_disparo: '',
  dt_inicio: '',
  dt_fim: '',
  account: '',
  inbox: '',
  media_type: 'image',
  mime_type: 'image/jpeg',
  link_media: ''
});
const dias = ref(new Set(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']));
const contacts = ref([]);
const detectedVars = ref(new Set());
const inboxes = ref([]);
const isCSVMode = ref(false);
const csvFile = ref(null);
const alert = ref({ show: false, type: '', message: '' });
const loading = ref(false);
const newContact = ref({ name: '', phone: '', vars: {} });
function formatTimeInput(event) {
  const input = event?.target?.value || '';
  if (input) {
    form.value.horario_disparo = input.includes(':') ? input : `${input}:00`;
  }
}
// Variáveis computadas
const detectedVarsArray = computed(() => Array.from(detectedVars.value).sort((a, b) => parseInt(a) - parseInt(b)));
// Sincroniza variáveis quando o conjunto detectado muda
watch(detectedVarsArray, (arr) => {
  const vars = { ...newContact.value.vars };
  Object.keys(vars).forEach(k => {
    if (!arr.includes(k)) delete vars[k];
  });
  arr.forEach(v => {
    if (vars[v] === undefined) vars[v] = '';
  });
  newContact.value = { ...newContact.value, vars };
});
// Métodos de API
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
async function getInboxes(accId) {
  if (!accId) return [];
  try {
    const client = new ApiClient(`accounts/${accId}/inboxes`);
    const res = await client.get();
    const data = res?.data;
    const list = Array.isArray(data?.payload)
      ? data.payload
      : Array.isArray(data)
        ? data
        : [];
    return list.map(i => ({ id: i.id, name: i.name }));
  } catch (e) {
    return [];
  }
}
async function loadInboxes() {
  inboxes.value = await getInboxes(accountId.value);
}
watch(accountId, () => {
  if (accountId.value) loadInboxes();
}, { immediate: true });
// Helpers
function n8nNormalizarTelefone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return phone;
  return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
}
function n8nParaHHMMSS(value) {
  if (!value) return '';
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
}
function n8nParaDatetimeLocal(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 16);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function inferMediaType(url) {
  if (!url) return null;
  try {
    const ext = new URL(url.trim()).pathname.split('.').pop().toLowerCase().split('?')[0];
    for (const [type, data] of Object.entries(MEDIA_TYPES)) {
      const idx = data.extensions.indexOf(ext);
      if (idx !== -1) return { media_type: type, mime_type: data.mimeTypes[idx] };
    }
    return null;
  } catch { return null; }
}
// Detectar variáveis
function detectVariables(message) {
  const vars = new Set();
  const regex = /\{\s*(\d+)\s*\}/g;
  let match;
  while ((match = regex.exec(message)) !== null) vars.add(match[1]);
  return vars;
}
watch(() => form.value.mensagem, (msg) => {
  detectedVars.value = detectVariables(msg || '');
});
// Contatos
function addContact() {
  const name = (newContact.value.name || '').trim();
  const phone = (newContact.value.phone || '').trim();
  if (!phone) {
    showAlert('bad', 'O telefone é obrigatório');
    return;
  }
  const vars = {};
  detectedVarsArray.value.forEach(v => {
    const val = (newContact.value.vars?.[v] || '').trim();
    if (val) vars[v] = val;
  });
  const missing = detectedVarsArray.value.filter(v => !(newContact.value.vars?.[v]?.trim()));
  if (missing.length) {
    showAlert('bad', `Preencha as variáveis: ${missing.map(v => `{${v}}`).join(', ')}`);
    return;
  }
  contacts.value.push({
    name,
    phone: n8nNormalizarTelefone(phone),
    vars
  });
  clearNewContactFields();
  showAlert('ok', 'Contato adicionado!');
  setTimeout(() => alert.value.show = false, 1500);
}
function removeContact(index) {
  contacts.value.splice(index, 1);
}
function clearNewContactFields() {
  newContact.value = { name: '', phone: '', vars: {} };
}
function checkContactVarsComplete(contact) {
  if (detectedVars.value.size === 0) return true;
  return detectedVarsArray.value.every(v => contact.vars?.[v]?.trim());
}
// CSV
function handleCSVUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  csvFile.value = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const result = parseCSV(e.target.result);
      showAlert('ok', `Importados ${result.imported} contatos`);
    } catch (err) {
      showAlert('bad', err.message);
    }
  };
  reader.readAsText(file, 'utf-8');
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) throw new Error('CSV deve ter cabeçalho e dados');
  const delim = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
  const parseLine = (line) => {
    const res = [], buf = [];
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === delim && !inQ) { res.push(buf.join('').trim()); buf.length = 0; }
      else buf.push(c);
    }
    res.push(buf.join('').trim());
    return res;
  };
  const headers = parseLine(lines[0]).map(h => h.toLowerCase().replace(/['"]/g, '').trim());
  const data = lines.slice(1).map(parseLine);
  const phoneIdx = headers.findIndex(h => ['phone', 'telefone', 'celular', 'whatsapp'].includes(h));
  if (phoneIdx === -1) throw new Error('CSV deve ter coluna de telefone');
  let imported = 0;
  data.forEach(row => {
    const phone = row[phoneIdx]?.trim();
    if (!phone) return;
    const vars = {};
    detectedVarsArray.value.forEach(v => {
      const idx = headers.findIndex(h => h === `var_${v}` || h === `{${v}}`);
      if (idx !== -1) vars[v] = row[idx]?.trim() || '';
    });
    contacts.value.push({
      name: '',
      phone: n8nNormalizarTelefone(phone),
      vars
    });
    imported++;
  });
  return { imported };
}
function downloadTemplateCSV() {
  const headers = ['name', 'phone'];
  detectedVarsArray.value.forEach(v => headers.push(`var_${v}`));
  const rows = [
    headers.join(','),
    ...Array.from({ length: 3 }, (_, i) => {
      const row = [`Nome ${i + 1}`, `+55${32999990000 + i}`];
      detectedVarsArray.value.forEach(v => row.push(`valor_${v}_${i + 1}`));
      return row.join(',');
    })
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'contatos_modelo.csv';
  a.click();
}
// Alertas
function showAlert(type, message) {
  alert.value = { show: true, type, message };
}
function hideAlert() {
  alert.value.show = false;
}
// Toggle dias
function toggleDia(key) {
  if (dias.value.has(key)) dias.value.delete(key);
  else dias.value.add(key);
}
// Submit
function tryAutoAddPendingContact() {
  if (contacts.value.length > 0) return;
  const hasPending = (
    (newContact.value.name || '').trim() ||
    (newContact.value.phone || '').trim() ||
    detectedVarsArray.value.some(v => (newContact.value.vars?.[v] || '').trim())
  );
  if (hasPending) addContact();
}
async function handleSubmit() {
  hideAlert();
  tryAutoAddPendingContact();
  if (contacts.value.length === 0) {
    showAlert('bad', 'Adicione pelo menos um contato');
    return;
  }
  const incomplete = contacts.value.filter(c => !checkContactVarsComplete(c));
  if (incomplete.length > 0) {
    showAlert('bad', `${incomplete.length} contato(s) com variáveis faltando`);
    return;
  }
  const payload = {
    nome: form.value.nome.trim(),
    mensagem: form.value.mensagem.trim(),
    horario_disparo: n8nParaHHMMSS(form.value.horario_disparo),
    dt_inicio: form.value.dt_inicio,
    dt_fim: form.value.dt_fim,
    lista_contato: contacts.value.map(c => ({ numero: c.phone, variaveis: c.vars })),
    dias_semana: Array.from(dias.value),
    account: form.value.account,
    inbox: form.value.inbox,
    media_type: form.value.media_type,
    mime_type: form.value.mime_type,
    link_media: form.value.link_media || null
  };
  loading.value = true;
  try {
    if (props.mode === 'edit' && props.campaignId) {
      await n8nRequest('PUT', `https://iara.impulsocore.com.br/n8n/webhook/7dff913d-f688-47df-8ca9-ee7d01a587f9/campanha/${props.campaignId}`, payload);
    } else {
      await n8nRequest('POST', 'https://iara.impulsocore.com.br/n8n/webhook/campanha', payload);
    }
    showAlert('ok', props.mode === 'edit' ? 'Atualizado com sucesso!' : 'Campanha criada!');
    setTimeout(() => emit('saved'), 800);
  } catch (err) {
    showAlert('bad', err.message || 'Erro ao salvar');
  } finally {
    loading.value = false;
  }
}
// Inicialização
async function init() {
  form.value.account = accountId.value;
  await loadInboxes();
  if (props.mode === 'edit' && props.campaignId) {
    try {
      const data = await n8nRequest('GET', `https://iara.impulsocore.com.br/n8n/webhook/aaac0b72-f2ec-441f-aaa6-72a87b348f1e/campanha/${props.campaignId}`);
      const c = data;
      form.value.nome = c.nome || '';
      form.value.mensagem = c.mensagem || '';
      form.value.horario_disparo = (c.horario_disparo || '').slice(0, 5);
      form.value.dt_inicio = n8nParaDatetimeLocal(c.dt_inicio);
      form.value.dt_fim = n8nParaDatetimeLocal(c.dt_fim);
      form.value.account = c.account || accountId.value;
      form.value.inbox = c.inbox || '';
      form.value.media_type = c.media_type || 'image';
      form.value.mime_type = c.mime_type || '';
      form.value.link_media = c.link_media || '';
      dias.value = new Set(c.dias_semana || []);
      contacts.value = (c.lista_contato || []).map(l => ({ name: '', phone: l.numero || '', vars: l.variaveis || {} }));
    } catch (err) {
      showAlert('bad', 'Erro ao carregar dados');
    }
  }
}
watch(() => props.show, (show) => {
  if (show) init();
});
onMounted(() => {
  if (props.show) init();
});
function handleMediaLinkChange() {
  const result = inferMediaType(form.value.link_media);
  if (result) {
    form.value.media_type = result.media_type;
    form.value.mime_type = result.mime_type;
  }
}
</script>
<template>
  <teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-3">
      <div class="absolute inset-0 bg-n-solid-12/50 backdrop-blur-sm" @click="$emit('close')" />
      <div class="relative w-full max-w-5xl max-h-[calc(100vh-24px)] overflow-y-auto rounded-xl border border-n-weak bg-n-solid-1 shadow-xl">
        <form @submit.prevent="handleSubmit" class="flex h-full flex-col min-h-0">
          <header class="flex items-center justify-between px-5 pt-4 pb-3 border-b border-n-weak">
            <div class="space-y-1">
              <h1 class="text-lg font-semibold text-n-slate-12">
                {{ mode === 'edit' ? 'Editar Campanha' : 'Nova Campanha' }}
              </h1>
              <p v-if="mode === 'edit'" class="text-xs text-n-slate-11">ID: {{ campaignId }}</p>
            </div>
            <button type="button" class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-n-weak text-n-slate-11 transition hover:bg-n-solid-3" @click="$emit('close')">✕</button>
          </header>
          <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <!-- Dados Básicos -->
            <section class="space-y-3">
              <h2 class="text-sm font-medium text-n-slate-11">Dados da Campanha</h2>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="space-y-1.5">
                  <label for="nome" class="text-xs font-medium text-n-slate-11">Nome</label>
                  <input id="nome" v-model="form.nome" type="text" placeholder="Ex: Campanha Janeiro" required class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 placeholder:text-n-slate-9 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
                </div>
                <div class="space-y-1.5">
                  <label for="horario_disparo" class="text-xs font-medium text-n-slate-11">Horário de disparo</label>
                  <input id="horario_disparo" v-model="form.horario_disparo" type="time" required class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
                </div>
              </div>
            </section>
            <!-- Mensagem -->
            <section class="space-y-3">
              <h2 class="text-sm font-medium text-n-slate-11">Mensagem</h2>
              <div class="space-y-1.5">
                <label for="mensagem" class="text-xs font-medium text-n-slate-11">Mensagem com variáveis</label>
                <textarea id="mensagem" v-model="form.mensagem" rows="4" placeholder="Olá {1}, tudo bem?" required class="min-h-[80px] w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 py-2 text-sm text-n-slate-12 placeholder:text-n-slate-9 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3"></textarea>
                <small class="text-xs leading-tight text-n-slate-11">Use {1}, {2}, {3}...</small>
              </div>
              <div v-if="detectedVarsArray.length" class="space-y-2">
                <label class="text-xs text-n-slate-11">Variáveis detectadas:</label>
                <div class="flex flex-wrap gap-2">
                  <span v-for="v in detectedVarsArray" :key="v" class="inline-flex items-center gap-2 rounded-md border border-n-weak bg-n-solid-2 px-2.5 py-1 text-xs font-medium text-n-slate-12">
                    <span class="font-semibold text-n-blue-11">{ {{ v }} }</span>
                  </span>
                </div>
              </div>
            </section>
            <br>
            <!-- Contatos -->
            <section class="space-y-3">
              <header class="flex flex-wrap items-center justify-between gap-3">
                <div class="space-y-1">
                  <h2 class="text-sm font-medium text-n-slate-11">Destinatários</h2>
                  <p class="text-xs text-n-slate-11">{{ contacts.length }} contato(s)</p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-n-weak bg-n-solid-1 px-3 py-2 text-sm font-medium text-n-slate-12 transition hover:bg-n-solid-2" @click="$refs.csvInput.click()">Importar CSV</button>
                  <button type="button" class="inline-flex items-center gap-2 rounded-lg border border-n-weak bg-n-solid-1 px-3 py-2 text-sm font-medium text-n-slate-12 transition hover:bg-n-solid-2" @click="downloadTemplateCSV">Baixar Modelo</button>
                  <input ref="csvInput" type="file" accept=".csv" hidden @change="handleCSVUpload" />
                </div>
              </header>
              <div v-if="detectedVarsArray.length === 0" class="rounded-lg border border-n-weak bg-n-solid-2 px-3 py-2 text-sm text-n-slate-11">
                Para adicionar destinatários, escreva uma mensagem com variáveis como <code class="rounded bg-n-solid-3 px-1">{1}</code>
              </div>
              <div class="flex items-center gap-2 text-sm text-n-slate-12">
                <button type="button" class="inline-flex items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium transition" :class="isCSVMode ? 'border-n-blue-border bg-n-blue-3 text-n-blue-11' : 'border-n-weak bg-n-solid-1 text-n-slate-12 hover:bg-n-solid-3'" @click="isCSVMode = !isCSVMode">
                  <span class="h-3.5 w-3.5 rounded-full border border-n-weak" :class="isCSVMode ? 'bg-n-blue-11' : 'bg-n-solid-1'"></span>
                  {{ isCSVMode ? 'Importação CSV' : 'Inserção Manual' }}
                </button>
              </div>
              <!-- Adicionar Contato Manual -->
              <div v-if="!isCSVMode" class="rounded-lg border border-n-weak bg-n-solid-2 p-4">
                <h3 class="mb-3 text-sm font-medium text-n-slate-12">Adicionar contato</h3>
                <div class="grid gap-3 md:grid-cols-2">
                  <div class="space-y-1.5">
                    <label for="newName" class="text-xs font-medium text-n-slate-11">Nome</label>
                    <input id="newName" v-model="newContact.name" type="text" placeholder="Ex: João Silva" class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 placeholder:text-n-slate-9 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
                  </div>
                  <div class="space-y-1.5">
                    <label for="newPhone" class="text-xs font-medium text-n-slate-11">Telefone</label>
                    <input id="newPhone" v-model="newContact.phone" type="tel" placeholder="+55 32 99999-9999" class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 placeholder:text-n-slate-9 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
                  </div>
                </div>
                <div v-if="detectedVarsArray.length" class="mt-3 grid gap-2">
                  <div v-for="v in detectedVarsArray" :key="v" class="space-y-1.5">
                    <label :for="'newVar' + v" class="text-xs font-medium text-n-slate-11">Valor para { {{ v }} }</label>
                    <input :id="'newVar' + v" v-model="newContact.vars[v]" type="text" :placeholder="'Valor da variável ' + v" class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 placeholder:text-n-slate-9 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
                  </div>
                </div>
                <div class="mt-4">
                  <button type="button" class="inline-flex items-center justify-center gap-2 rounded-lg border border-n-weak bg-n-solid-1 px-4 py-2.5 text-sm font-medium text-n-slate-12 transition hover:bg-n-solid-2" @click="addContact">+ Adicionar Contato</button>
                </div>
              </div>
              <!-- Lista de Contatos -->
              <div class="space-y-2">
                <div v-for="(c, i) in contacts" :key="i" class="flex items-start justify-between gap-3 rounded-lg border border-n-weak bg-n-solid-1 p-3 transition hover:border-n-container">
                  <div class="flex flex-1 flex-col gap-1">
                    <span class="text-sm font-medium text-n-slate-12">{{ c.name || '(sem nome)' }}</span>
                    <span class="text-xs text-n-slate-11">{{ c.phone }}</span>
                    <div v-if="Object.keys(c.vars).length" class="flex flex-wrap gap-2">
                      <span v-for="(val, k) in c.vars" :key="k" class="inline-flex items-center gap-2 rounded-md bg-n-solid-3 px-2 py-1 text-[11px] font-medium text-n-slate-12">{ {{ k }} }: {{ val }}</span>
                    </div>
                    <p v-if="!checkContactVarsComplete(c)" class="text-xs font-medium text-n-ruby-11">⚠️ Preencha todas as variáveis</p>
                  </div>
                  <div class="mt-1 flex-shrink-0">
                    <button type="button" class="inline-flex items-center justify-center rounded-md border border-n-weak px-2.5 py-1.5 text-xs text-n-slate-11 transition hover:bg-n-ruby-2 hover:text-n-ruby-11" @click="removeContact(i)">🗑️</button>
                  </div>
                </div>
                <p v-if="!contacts.length" class="py-4 text-center text-xs text-n-slate-11">Nenhum contato adicionado ainda</p>
              </div>
            </section>
            <!-- Configurações -->
            <section class="space-y-3">
              <h2 class="text-sm font-medium text-n-slate-11">Configurações</h2>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="space-y-1.5">
                  <label for="dt_inicio" class="text-xs font-medium text-n-slate-11">Início</label>
                  <input id="dt_inicio" v-model="form.dt_inicio" type="datetime-local" lang="pt-BR" required class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
                </div>
                <div class="space-y-1.5">
                  <label for="dt_fim" class="text-xs font-medium text-n-slate-11">Fim</label>
                  <input id="dt_fim" v-model="form.dt_fim" type="datetime-local" lang="pt-BR" required class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
                </div>
              </div>
              <div class="grid gap-3 md:grid-cols-2">
                <div class="space-y-1.5">
                  <label for="account" class="text-xs font-medium text-n-slate-11">Account</label>
                  <input id="account" v-model="form.account" type="number" readonly required class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-2 px-3 text-sm text-n-slate-11" />
                </div>
                <div class="space-y-1.5">
                  <label for="inbox" class="text-xs font-medium text-n-slate-11">Inbox</label>
                  <select id="inbox" v-model="form.inbox" required class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3">
                    <option value="">Selecione...</option>
                    <option v-for="ib in inboxes" :key="ib.id" :value="ib.id">{{ ib.name }}</option>
                  </select>
                </div>
              </div>
            </section>
            <!-- Mídia -->
            <section class="space-y-3">
              <div class="space-y-1.5">
                <label for="link_media" class="text-xs font-medium text-n-slate-11">Link da mídia</label>
                <input id="link_media" v-model="form.link_media" type="url" placeholder="https://..." @input="handleMediaLinkChange" class="h-10 w-full rounded-lg border border-n-weak bg-n-solid-1 px-3 text-sm text-n-slate-12 placeholder:text-n-slate-9 focus:border-n-blue-border focus:outline-none focus:ring-2 focus:ring-n-blue-3" />
              </div>
            </section>
            <!-- Dias -->
            <section class="space-y-2">
              <label class="text-xs font-medium text-n-slate-11">Dias da semana</label>
              <div class="flex flex-wrap gap-2">
                <button v-for="d in DAYS" :key="d.key" type="button" class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition" :class="dias.has(d.key) ? 'border-n-blue-border bg-n-blue-3 text-n-blue-11' : 'border-n-weak bg-n-solid-1 text-n-slate-12 hover:bg-n-solid-3'" @click="toggleDia(d.key)">{{ d.label }}</button>
              </div>
            </section>
            <div v-if="alert.show" class="rounded-lg border px-3 py-2 text-sm" :class="alert.type === 'ok' ? 'border-n-blue-border bg-n-blue-3 text-n-blue-11' : 'border-n-ruby-6 bg-n-ruby-2 text-n-ruby-11'">{{ alert.message }}</div>
          </div>
          <footer class="flex justify-end gap-3 border-t border-n-weak bg-n-solid-2 px-5 py-3">
            <button type="button" class="inline-flex items-center justify-center gap-2 rounded-lg border border-n-weak bg-n-solid-1 px-4 py-2.5 text-sm font-medium text-n-slate-12 transition hover:bg-n-solid-3" @click="$emit('close')">Cancelar</button>
            <button type="submit" :disabled="loading" class="inline-flex items-center justify-center gap-2 rounded-lg bg-n-brand px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-n-blue-10 disabled:cursor-not-allowed disabled:opacity-70">{{ loading ? 'Salvando...' : (mode === 'edit' ? 'Salvar' : 'Criar') }}</button>
          </footer>
        </form>
      </div>
    </div>
  </teleport>
</template>
