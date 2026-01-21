/**
 * Serviço centralizado para API do N8n (Campanhas)
 * URL base: https://iara.impulsocore.com.br/n8n/webhook
 */

// #region CONFIGURAÇÃO
const N8N_BASE_URL = "https://iara.impulsocore.com.br/n8n/webhook";
const N8N_ENDPOINT = `${N8N_BASE_URL}/campanha`;
// #endregion

// #region FUNÇÕES DE REQUISIÇÃO HTTP
/**
 * Realiza uma requisição HTTP para a API do N8n
 * @param {string} method - Método HTTP (GET, POST, PUT, DELETE)
 * @param {string} url - URL da requisição
 * @param {object} [body] - Corpo da requisição (opcional)
 * @returns {Promise<any>} - Dados da resposta
 */
async function n8nRequest(method, url, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" }
  };

  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }

  // Log da request no console
  console.group(`🔄 N8n Request: ${method} ${url}`);
  console.log('Method:', method);
  console.log('URL:', url);
  if (body !== undefined) {
    console.log('Body:', body);
  }
  console.groupEnd();

  const res = await fetch(url, opts);

  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error
      ? JSON.stringify(data.error)
      : (data?.raw || res.statusText);
    throw new Error(`HTTP ${res.status}: ${msg}`);
  }

  return data;
}
// #endregion

// #region CAMPANHAS - API N8N
/**
 * Lista todas as campanhas
 * @returns {Promise<Array>} - Lista de campanhas
 */
async function n8nListarCampanhas() {
  return n8nRequest("GET", N8N_ENDPOINT);
}

/**
 * Busca uma campanha pelo ID
 * @param {number|string} id - ID da campanha
 * @returns {Promise<object>} - Dados da campanha
 */
async function n8nBuscarCampanha(id) {
  return n8nRequest("GET", `${"https://iara.impulsocore.com.br/n8n/webhook/aaac0b72-f2ec-441f-aaa6-72a87b348f1e/campanha"}/${id}`);
}

/**
 * Cria uma nova campanha
 * @param {object} dados - Dados da campanha
 * @returns {Promise<object>} - Campanha criada
 */
async function n8nCriarCampanha(dados) {
  return n8nRequest("POST", N8N_ENDPOINT, dados);
}

/**
 * Atualiza uma campanha existente
 * @param {number|string} id - ID da campanha
 * @param {object} dados - Dados atualizados
 * @returns {Promise<object>} - Campanha atualizada
 */
async function n8nAtualizarCampanha(id, dados) {
  return n8nRequest("PUT", `${"https://iara.impulsocore.com.br/n8n/webhook/7dff913d-f688-47df-8ca9-ee7d01a587f9/campanha"}/${id}`, dados);
}

/**
 * Exclui uma campanha (soft delete)
 * @param {number|string} id - ID da campanha
 * @returns {Promise<any>} - Resposta da exclusão
 */
async function n8nExcluirCampanha(id) {
  return n8nRequest("DELETE", `${"https://iara.impulsocore.com.br/n8n/webhook/eeb42db5-630e-44ff-a439-ab8ce2418dba/campanha"}/${id}`);
}

/**
 * Verifica se a API está online (ping)
 * @returns {Promise<boolean>} - true se online
 */
async function n8nPing() {
  try {
    await n8nRequest("GET", N8N_ENDPOINT);
    return true;
  } catch {
    return false;
  }
}
// #endregion

// #region HELPERS
/**
 * Normaliza dados vindos do banco
 * @param {object} row - Registro do banco
 * @returns {object} - Dados normalizados
 */
function n8nNormalizarDados(row) {
  let listaContato = row.lista_contato;
  if (typeof listaContato === "string") {
    try {
      listaContato = JSON.parse(listaContato);
    } catch {
      listaContato = [];
    }
  }

  return {
    ...row,
    lista_contato: Array.isArray(listaContato) ? listaContato : [],
    dias_semana: Array.isArray(row.dias_semana) ? row.dias_semana : []
  };
}

/**
 * Normaliza número de telefone
 * @param {string} phone - Telefone a ser normalizado
 * @returns {string} - Telefone normalizado
 */
function n8nNormalizarTelefone(phone) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return phone;

  if (!phone.startsWith("+")) {
    return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
  }
  return phone;
}

/**
 * Converte formato time input para HH:MM:SS
 * @param {string} value - Valor do input time
 * @returns {string} - Formatado como HH:MM:SS
 */
function n8nParaHHMMSS(value) {
  if (!value) return "";
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  if (/^\d{2}:\d{2}$/.test(value) || /^\d{2}:\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
}

/**
 * Converte data para formato datetime-local
 * @param {string} value - Data ou datetime
 * @returns {string} - Formatado como YYYY-MM-DDTHH:MM
 */
function n8nParaDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return String(value).slice(0, 16);
  }
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// #endregion

// #region EXPORT (para módulos ES6)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    n8nRequest,
    n8nListarCampanhas,
    n8nBuscarCampanha,
    n8nCriarCampanha,
    n8nAtualizarCampanha,
    n8nExcluirCampanha,
    n8nPing,
    n8nNormalizarDados,
    n8nNormalizarTelefone,
    n8nParaHHMMSS,
    n8nParaDatetimeLocal,
    N8N_BASE_URL,
    N8N_ENDPOINT
  };
}
// #endregion
