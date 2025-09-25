/* eslint-disable */
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from 'vue';
import axios from 'axios';
import { useAlert } from 'dashboard/composables';

export function useEventsForm(props, emit) {
  const API_BASE =
    'https://f4wzfjousg.execute-api.us-east-1.amazonaws.com/schedules';
  const AGENTS_API =
    'https://f4wzfjousg.execute-api.us-east-1.amazonaws.com/get-agents-list';
  const TEMPLATES_API =
    'https://f4wzfjousg.execute-api.us-east-1.amazonaws.com/get-whatsapp-templates-list';

  const DAYS_OF_WEEK = [
    { value: 'MON', label: 'Segunda' },
    { value: 'TUE', label: 'Terça' },
    { value: 'WED', label: 'Quarta' },
    { value: 'THU', label: 'Quinta' },
    { value: 'FRI', label: 'Sexta' },
    { value: 'SAT', label: 'Sábado' },
    { value: 'SUN', label: 'Domingo' },
  ];

  function pad(n) {
    return String(n).padStart(2, '0');
  }
  function generateTimeOptions(step = 15) {
    const options = [];
    for (let h = 0; h < 24; h += 1) {
      for (let m = 0; m < 60; m += step) {
        options.push(`${pad(h)}:${pad(m)}`);
      }
    }
    return options;
  }
  const TIME_OPTIONS = Object.freeze(generateTimeOptions(15));
  const WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI']);
  const BRT_TIMEZONE = 'America/Sao_Paulo';
  const MIN_FUTURE_MINUTES = 3; // minimal buffer before upcoming slot becomes unavailable
  const NAME_ALLOWED_REGEX = /^[A-Za-z0-9_-]+$/;
  const PHONE_MAX_DIGITS = 13;
  const RESERVED_TEMPLATE_VARIABLES = new Set(['name']);

  // Input mask helpers and validators
  function onlyDigits(s) {
    return (s || '').replace(/\D/g, '');
  }

  function expandScientificNotation(raw) {
    const trimmed = (raw ?? '').toString().trim();
    if (!trimmed) return '';
    const normalized = trimmed.replace(',', '.');
    const match = /^([-+]?\d+(?:\.\d+)?)e\+?(\d+)$/i.exec(normalized);
    if (!match) return trimmed;

    const mantissa = match[1];
    const exponent = Number(match[2]);
    if (!Number.isFinite(exponent)) return trimmed;

    const sign = mantissa.startsWith('-') ? '-' : '';
    const unsignedMantissa = mantissa.replace(/^[+-]/, '');
    const [integerPart, fractionalPart = ''] = unsignedMantissa.split('.');
    const digits = integerPart + fractionalPart;
    const shift = exponent - fractionalPart.length;

    if (shift >= 0) {
      return sign + digits + '0'.repeat(shift);
    }

    const splitIndex = digits.length + shift;
    if (splitIndex <= 0) {
      return sign + '0.' + '0'.repeat(-splitIndex) + digits;
    }

    return sign + digits.slice(0, splitIndex) + '.' + digits.slice(splitIndex);
  }

  function extractPhoneDigits(raw) {
    return onlyDigits(expandScientificNotation(raw));
  }
  function maskDateDDMMYYYY(raw) {
    const d = onlyDigits(raw).slice(0, 8);
    if (d.length <= 2) return d;
    if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  }
  function daysInMonth(y, m) {
    // m is 1..12
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }
  function isValidDateDMY(str) {
    if (typeof str !== 'string') return false;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(str);
    if (!m) return false;
    const dd = Number(m[1]);
    const mm = Number(m[2]);
    const yyyy = Number(m[3]);
    if (yyyy < 1900 || yyyy > 9999) return false;
    if (mm < 1 || mm > 12) return false;
    if (dd < 1 || dd > daysInMonth(yyyy, mm)) return false;
    return true;
  }
  function maskTimeHHMM(raw) {
    const n = onlyDigits(raw).slice(0, 4);
    if (n.length <= 2) return n;
    return `${n.slice(0, 2)}:${n.slice(2)}`;
  }
  function isValidTimeHHMM(str) {
    if (typeof str !== 'string') return false;
    const m = /^(\d{2}):(\d{2})$/.exec(str);
    if (!m) return false;
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh < 0 || hh > 23) return false;
    if (mm < 0 || mm > 59) return false;
    return true;
  }
  // Strict time masker: builds HH:MM and ignores invalid keystrokes (prevents >23:59)
  function maskTimeHHMMStrict(raw) {
    const d = onlyDigits(raw).slice(0, 4);
    let outH1 = '';
    let outH2 = '';
    let outM1 = '';
    let outM2 = '';

    for (let i = 0; i < d.length; i += 1) {
      const ch = d[i];
      if (i === 0) {
        // First hour digit must be 0-2
        if (ch >= '0' && ch <= '2') outH1 = ch;
      } else if (i === 1) {
        if (!outH1) break;
        // Second hour digit: if first is 2 then 0-3, else 0-9
        if (outH1 === '2') {
          if (ch >= '0' && ch <= '3') outH2 = ch;
        } else {
          outH2 = ch;
        }
      } else if (i === 2) {
        // First minute digit 0-5
        if (ch >= '0' && ch <= '5') outM1 = ch;
      } else if (i === 3) {
        // Second minute digit 0-9
        outM2 = ch;
      }
    }

    let res = '';
    if (outH1) res += outH1;
    if (outH2) res += outH2;
    if (res.length > 0 && (outM1 || outM2)) res += ':';
    if (outM1) res += outM1;
    if (outM2) res += outM2;
    return res;
  }

  function getTimeZoneParts(date, timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).formatToParts(date);
      const result = {};
      parts.forEach(part => {
        if (part.type !== 'literal') result[part.type] = part.value;
      });
      return result;
    } catch (_e) {
      return null;
    }
  }
  function toUtcIsoFromDate(dateString, timeString, timeZone) {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-').map(Number);
    if (!year || !month || !day) return '';
    const [hour = 0, minute = 0, second = 0] = (timeString || '00:00:00')
      .split(':')
      .map(Number);
    const base = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const parts = getTimeZoneParts(base, timeZone);
    if (!parts) return base.toISOString();
    const asUTC = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second)
    );
    const offsetMs = asUTC - base.getTime();
    const target = new Date(base.getTime() - offsetMs);
    return target.toISOString();
  }
  function isoDateInTimezone(isoString, timeZone) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    try {
      const parts = getTimeZoneParts(date, timeZone);
      if (!parts) return isoString.substring(0, 10);
      return `${parts.year}-${parts.month}-${parts.day}`;
    } catch (_e) {
      return isoString.substring(0, 10);
    }
  }
  function isoToLocalDateTime(isoString, timeZone) {
    if (!isoString) return '';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return '';
    try {
      const parts = getTimeZoneParts(date, timeZone);
      if (!parts) {
        return isoString.substring(0, 16);
      }
      const datePart = [parts.year, parts.month, parts.day].join('-');
      const timePart = parts.hour + ':' + parts.minute;
      return datePart + 'T' + timePart;
    } catch (_e) {
      return isoString.substring(0, 16);
    }
  }
  function localDateTimeToIso(localValue, timeZone) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue || '');
    if (!match) return '';
    const [, year, month, day, hour, minute] = match;
    const datePart = year + '-' + month + '-' + day;
    const timePart = hour + ':' + minute + ':00';
    return toUtcIsoFromDate(datePart, timePart, timeZone);
  }
  function compareLocalDateTime(a, b) {
    if (!a || !b) return 0;
    return a.localeCompare(b);
  }
  function shiftDateString(dateString, days) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString || '');
    if (!match) return dateString;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const base = new Date(Date.UTC(year, month - 1, day + days));
    const yyyy = base.getUTCFullYear();
    const mm = String(base.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(base.getUTCDate()).padStart(2, '0');
    return yyyy + '-' + mm + '-' + dd;
  }
  function formatLocalDateTimeFromState(state) {
    let totalMinutes = state.minutes + MIN_FUTURE_MINUTES;
    let datePart = state.date;
    while (totalMinutes >= 24 * 60) {
      totalMinutes -= 24 * 60;
      datePart = shiftDateString(datePart, 1);
    }
    while (totalMinutes < 0) {
      totalMinutes += 24 * 60;
      datePart = shiftDateString(datePart, -1);
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    return datePart + 'T' + hh + ':' + mm;
  }
  function isValidLocalDateTime(value) {
    return /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.test(value || '');
  }
  function minutesFromHM(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value || '');
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }
  function getNowInTimezone(timeZone) {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const lookup = parts.reduce((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
    const date = `${lookup.year}-${lookup.month}-${lookup.day}`;
    const hour = Number(lookup.hour || '0');
    const minute = Number(lookup.minute || '0');
    return {
      date,
      minutes: hour * 60 + minute,
      seconds: Number(lookup.second || '0'),
    };
  }
  function sanitizeScheduleName(raw) {
    return (raw || '').replace(/[^A-Za-z0-9_-]/g, '');
  }

  const text = Object.freeze({
    name: {
      label: 'Nome do agendamento', 
      placeholder: 'Insira o nome do agendamento aqui',
      required: 'Campo obrigatório',
      invalid: 'Use apenas letras, números, hífen (-) ou underline (_).',
    },
    channel: {
      label: 'Canal',
      placeholder: 'Selecionar canal',
      options: {
        whatsapp: 'WhatsApp',
        // email: 'Email (SES)',
      },
    },
    tooltips: {
      channel: 'Informe um nome para o agendamento antes de escolher o canal.',
      agent: 'Selecione o canal para habilitar os agentes disponíveis.',
    },
    agent: {
      label: 'Telefone de Canal/Inbox',
      hint: 'Mensagens serão enviadas a partir do número selecionado.',
      placeholder: 'Selecionar...',
    },
    customField: {
      title: 'Variáveis',
      empty:
        'Nenhuma variável detectada ainda. Utilize placeholders como {{nome}} na mensagem para adicioná-las automaticamente.',
      valuePlaceholder: 'Preencha o valor para este destinatário',
    },
    recipients: {
      title: 'Destinatários',
      subtitle:
        'Adicione manualmente, importe um CSV ou defina variáveis personalizadas.',
      import: 'Importar CSV',
      download: 'Modelo CSV',
      add: 'Adicionar destinatário',
      empty: 'Adicione manualmente ou importe via CSV para iniciar o envio.',
      remove: 'Remover',
      firstContact: 'Primeiro contato (Template)',
      name: 'Nome',
      email: 'Email',
      phone: 'Telefone (WhatsApp)',
      noName: '(sem nome)',
      namePlaceholder: 'Ana',
      emailPlaceholder: 'ana@exemplo.com',
      phonePlaceholder: '+5532999999999',
      csv: {
        empty: 'CSV vazio ou sem cabeçalho.',
        invalidEmail: 'Cabeçalho inválido. Esperado: name/nome, email/e-mail.',
        invalidWhatsapp:
          'Cabeçalho inválido. Esperado: name/nome, phone/telefone/celular/whatsapp.',
        error: 'Erro ao processar o CSV.',
        summary: (imported, skipped, total) =>
          `Importados ${imported}. Ignorados ${skipped}. Total agora: ${total}.`,
      },
    },
    content: {
      title: 'Template de primeiro contato',
      description:
        'Personalize o conteúdo com variáveis utilizando o formato {{name}}.',
      subject: 'Assunto',
      subjectPlaceholder: 'Mensagem',
      text: 'Texto (plain)',
      textPlaceholder: 'Olá {{name}}!',
      html: 'HTML (opcional)',
      htmlPlaceholder: '<p>Olá {{name}}!</p>',
      templateLabel: 'Templates',
      templateSelect: {
        loading: 'Carregando templates...',
        placeholder: 'Selecionar template...',
        empty: 'Nenhum template encontrado',
        required: 'Selecione um template de primeiro contato.',
      },
      templateActions: {
        reload: 'Recarregar',
        sync: 'Sincronizar',
        apply: 'Aplicar',
      },
      templatePlaceholders: 'Placeholders do template:',
    },
    placeholders: {
      global: message => message,
      day: message => message,
    },
    schedule: {
      title: 'Recorrência',
      description:
        'Defina os dias, datas e horários válidos para o agendamento.',
      timezone: 'Timezone',
      timezoneStatic: '— não aplicável —',
      days: 'Dias da semana',
      time: 'Horário (HH:mm)',
      timePlaceholder: 'Selecionar horário',
      timezonePlaceholder: 'America/Sao_Paulo',
      dayMessagesTitle: 'Mensagens por dia selecionado',
      messageLabel: day => `Mensagem para ${day}`,
      missingMessage: day => `Obrigatório para ${day}.`,
      timeRequiresDate: 'Defina uma data inicial para habilitar os horários.',
      timeRequired: 'Selecione um horário válido.',
      timeTooSoon: 'Escolha um horário com pelo menos alguns minutos de antecedência.',
      timeUnavailable: 'Nenhum horário futuro disponível para hoje. Escolha outra data.',
    },
    timeframe: {
      start: 'Dt. de Início:',
      startPlaceholder: '2025-09-01T00:00:00Z',
      end: 'Dt. de Fim:',
      endPlaceholder: '2025-12-31T23:59:59Z',
      error: 'Escolha datas futuras e garanta que a data final seja posterior à inicial.',
    },
    toggle: 'Agendamento habilitado',
    actions: {
      save: 'Salvar agendamento',
      cancel: 'Cancelar',
    },
    status: {
      created: 'Agendamento criado com sucesso.',
      updated: 'Agendamento atualizado com sucesso.',
      error:
        'Falha ao salvar. Verifique os campos obrigatórios e tente novamente.',
    },
    alerts: {
      agents: 'Falha ao carregar agentes do WhatsApp.',
      templates: 'Falha ao carregar templates do WhatsApp.',
      syncSuccess: 'Templates sincronizados com sucesso.',
      syncError: 'Falha ao sincronizar templates.',
    },
  });

  const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Content-Type': 'application/json' },
  });

  const originalName = ref('');   
  const agents = ref([]);
  const agentsLoading = ref(false);
  const templates = ref([]);
  const templatesLoading = ref(false);
  const selectedTemplateKey = ref('');

  const form = reactive({
    name: '',
    channel: '',
    agent: '',
    recipients: [],
    payload: { message: 'Olá {{name}}!', messagesByDay: {} },
    customFields: [],
    enabled: true,
    daysOfWeek: [],
    time: '',
    timezone: BRT_TIMEZONE,
    startAt: '',
    endAt: '',
  });

  const dailyWeekdays = ref(false);
  const submitting = ref(false);
  const status = reactive({ show: false, ok: true, msg: '' });
  const csvReport = ref(null);
  const requiredPlaceholders = ref(new Set());
  const knownVariables = ref(new Map());
  const placeholderGlobalError = ref('');
  const placeholderDaysError = ref('');
  const templateFallback = ref(null);
  const firstContactAll = ref(false);
  const nowState = ref(getNowInTimezone(BRT_TIMEZONE));

  const isEdit = computed(() => Boolean(originalName.value));

  const isNameFilled = computed(() => !!form.name);
  const isNameValid = computed(
    () => isNameFilled.value && NAME_ALLOWED_REGEX.test(form.name)
  );
  const nameError = computed(() => {
    if (!isNameFilled.value) return text.name.required;
    if (!isNameValid.value) return text.name.invalid;
    return '';
  });
  const canSelectChannel = computed(() => isNameValid.value);
  const canSelectAgent = computed(() => canSelectChannel.value && !!form.channel);

  const startDateTimeInput = ref('');
  const endDateTimeInput = ref('');

  const startDateValue = computed(() => {
    if (!form.startAt) return '';
    return isoDateInTimezone(form.startAt, form.timezone || BRT_TIMEZONE);
  });
  const endDateValue = computed(() => {
    if (!form.endAt) return '';
    return isoDateInTimezone(form.endAt, form.timezone || BRT_TIMEZONE);
  });

  const startDateTimeMin = computed(() => formatLocalDateTimeFromState(nowState.value));
  const endDateTimeMin = computed(
    () => startDateTimeInput.value || startDateTimeMin.value
  );
  const isStartDateInPast = computed(() => {
    if (!startDateTimeInput.value) return false;
    return compareLocalDateTime(startDateTimeInput.value, startDateTimeMin.value) < 0;
  });

  const validDateRange = computed(() => {
    if (isStartDateInPast.value) return false;
    if (!startDateTimeInput.value || !endDateTimeInput.value) return true;
    return compareLocalDateTime(endDateTimeInput.value, startDateTimeInput.value) >= 0;
  });

  function initDefaultDates() {
    const today = nowState.value.date;
    if (!form.startAt) {
      form.startAt = toUtcIsoFromDate(
        today,
        '00:00:00',
        form.timezone || BRT_TIMEZONE
      );
    }
    if (!form.endAt) {
      form.endAt = toUtcIsoFromDate(
        today,
        '23:59:59',
        form.timezone || BRT_TIMEZONE
      );
    }
  }

  watch(
    () => form.startAt,
    iso => {
      const display = isoToLocalDateTime(iso, form.timezone || BRT_TIMEZONE);
      if (startDateTimeInput.value !== display) {
        startDateTimeInput.value = display;
      }
    },
    { immediate: true }
  );

  watch(
    () => form.endAt,
    iso => {
      const display = isoToLocalDateTime(iso, form.timezone || BRT_TIMEZONE);
      if (endDateTimeInput.value !== display) {
        endDateTimeInput.value = display;
      }
    },
    { immediate: true }
  );

  watch(startDateTimeInput, value => {
    if (!value) {
      form.startAt = '';
      return;
    }
    if (!isValidLocalDateTime(value)) return;
    let normalized = value;
    const minValue = startDateTimeMin.value;
    if (compareLocalDateTime(normalized, minValue) < 0) {
      normalized = minValue;
      if (startDateTimeInput.value !== normalized) {
        startDateTimeInput.value = normalized;
        return;
      }
    }
    const iso = localDateTimeToIso(normalized, form.timezone || BRT_TIMEZONE);
    if (form.startAt !== iso) {
      form.startAt = iso;
    }
    if (!endDateTimeInput.value || compareLocalDateTime(endDateTimeInput.value, normalized) < 0) {
      endDateTimeInput.value = normalized;
      const alignedIso = localDateTimeToIso(normalized, form.timezone || BRT_TIMEZONE);
      if (form.endAt !== alignedIso) {
        form.endAt = alignedIso;
      }
    }
  });

  watch(endDateTimeInput, value => {
    if (!value) {
      form.endAt = '';
      return;
    }
    if (!isValidLocalDateTime(value)) return;
    let normalized = value;
    const minValue = endDateTimeMin.value;
    if (compareLocalDateTime(normalized, minValue) < 0) {
      normalized = minValue;
      if (endDateTimeInput.value !== normalized) {
        endDateTimeInput.value = normalized;
        return;
      }
    }
    const iso = localDateTimeToIso(normalized, form.timezone || BRT_TIMEZONE);
    if (form.endAt !== iso) {
      form.endAt = iso;
    }
  });

  watch(
    () => form.timezone,
    () => {
      const tz = form.timezone || BRT_TIMEZONE;
      if (form.startAt) {
        const display = isoToLocalDateTime(form.startAt, tz);
        if (startDateTimeInput.value !== display) {
          startDateTimeInput.value = display;
        }
      } else {
        startDateTimeInput.value = '';
      }
      if (form.endAt) {
        const displayEnd = isoToLocalDateTime(form.endAt, tz);
        if (endDateTimeInput.value !== displayEnd) {
          endDateTimeInput.value = displayEnd;
        }
      } else {
        endDateTimeInput.value = '';
      }
      ensureValidTimeSelection();
    }
  );

  watch(startDateTimeMin, minValue => {
    if (startDateTimeInput.value && compareLocalDateTime(startDateTimeInput.value, minValue) < 0) {
      startDateTimeInput.value = minValue;
    }
  });

  watch(endDateTimeMin, minValue => {
    if (endDateTimeInput.value && compareLocalDateTime(endDateTimeInput.value, minValue) < 0) {
      endDateTimeInput.value = minValue;
    }
  });

  const selectedTemplate = computed(
    () =>
      templates.value.find(
        template => template.key === selectedTemplateKey.value
      ) || null
  );

  const showFirstContactTemplate = computed(() =>
    Boolean(firstContactAll.value)
  );

  const availableTimeOptions = computed(() => {
    if (!startDateValue.value) return [];
    const today = startDateValue.value === nowState.value.date;
    const minMinutes = today
      ? nowState.value.minutes + MIN_FUTURE_MINUTES
      : 0;
    return TIME_OPTIONS.filter(option => {
      const value = minutesFromHM(option);
      return value != null && value >= minMinutes;
    });
  });
  const hasAvailableTimes = computed(
    () => availableTimeOptions.value.length > 0
  );
  const isTimeSelectionEnabled = computed(
    () => Boolean(startDateValue.value) && hasAvailableTimes.value
  );
  const isTimeValid = computed(() => {
    if (!startDateValue.value) return false;
    if (!form.time) return false;
    const minutes = minutesFromHM(form.time);
    if (minutes == null) return false;
    if (startDateValue.value > nowState.value.date) return true;
    return minutes >= nowState.value.minutes + MIN_FUTURE_MINUTES;
  });
  const timeError = computed(() => {
    if (!startDateValue.value) return text.schedule.timeRequiresDate;
    if (!hasAvailableTimes.value) return text.schedule.timeUnavailable;
    if (!form.time) return text.schedule.timeRequired;
    if (!isTimeValid.value) return text.schedule.timeTooSoon;
    return '';
  });

  function ensureValidTimeSelection() {
    if (!startDateValue.value) {
      form.time = '';
      return;
    }
    const options = availableTimeOptions.value;
    if (!options.length) {
      form.time = '';
      return;
    }
    if (!form.time || !options.includes(form.time)) {
      form.time = options[0];
      return;
    }
    const currentMinutes = minutesFromHM(form.time);
    const minMinutes = startDateValue.value === nowState.value.date
      ? nowState.value.minutes + MIN_FUTURE_MINUTES
      : 0;
    if (currentMinutes != null && currentMinutes < minMinutes) {
      form.time = options[0];
    }
  }

  const variableEntries = computed(() => {
    const entries = [];
    knownVariables.value.forEach((info, key) => {
      if (RESERVED_TEMPLATE_VARIABLES.has(key)) return;
      entries.push({ key, label: info.raw || key });
    });
    return entries;
  });

  const variableLabelMap = computed(() => {
    const map = {};
    knownVariables.value.forEach((info, key) => {
      if (RESERVED_TEMPLATE_VARIABLES.has(key)) return;
      map[key] = info.raw || key;
    });
    return map;
  });

  const TEMPLATE_PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

  function combineTemplateTextFromComponents(components) {
    const sections = [];
    (components || []).forEach(component => {
      const type = (component?.type || '').toUpperCase();
      const textVal = component?.text || '';
      if (!textVal) return;
      if (type === 'HEADER' && (component?.format || '').toUpperCase() === 'TEXT') {
        sections.push(textVal);
      } else if (type === 'BODY') {
        sections.push(textVal);
      } else if (type === 'FOOTER') {
        sections.push(textVal);
      }
    });
    return sections.join('\n\n');
  }

  function extractPlaceholdersFromComponents(components) {
    const flat = [];
    const byComponent = {};

    (components || []).forEach(component => {
      const type = (component?.type || '').toLowerCase();
      const textVal = component?.text || '';
      if (!textVal) return;

      TEMPLATE_PLACEHOLDER_REGEX.lastIndex = 0;
      const entries = [];
      let match = TEMPLATE_PLACEHOLDER_REGEX.exec(textVal);
      while (match) {
        const rawKey = (match[1] || '').trim();
        const positionalMatch = /^var(\d+)$/i.exec(rawKey);
        const normalized = positionalMatch
          ? positionalMatch[1]
          : normalizeVarKey(rawKey);
        if (normalized) {
          entries.push({ raw: rawKey, normalized });
          if (!flat.includes(normalized)) {
            flat.push(normalized);
          }
        }
        match = TEMPLATE_PLACEHOLDER_REGEX.exec(textVal);
      }

      if (entries.length) {
        byComponent[type] = entries;
      }
    });

    return { flat, byComponent };
  }

  function buildTemplateFallbackObject(template) {
    if (!template) return null;

    const fallback = {
      name: template.name,
      language: template.language,
      category: template.category,
    };

    if (template.parameterFormat) {
      fallback.parameter_format = template.parameterFormat;
    }

    const params = {};
    const entriesByComponent = template.placeholderEntries || {};
    Object.entries(entriesByComponent).forEach(([component, entries]) => {
      if (!entries?.length) return;
      const mapping = {};
      entries.forEach(({ raw, normalized }) => {
        if (!normalized) return;
        const positionalMatch = /^var(\d+)$/.exec(raw);
        const paramKey = positionalMatch ? positionalMatch[1] : raw;
        mapping[paramKey] = `{{vars.${normalized}}}`;
      });
      if (Object.keys(mapping).length) {
        params[component] = mapping;
      }
    });

    if (Object.keys(params).length) {
      fallback.params = params;
    }

    return fallback;
  }

  function normalizeVarKey(value) {
    const trimmed = (value || '')
      .toString()
      .trim();
    const positionalMatch = /^var(\d+)$/i.exec(trimmed);
    if (positionalMatch) {
      return positionalMatch[1];
    }
    return trimmed.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
  }

  function normalizeHeader(value) {
    return (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_ -]/g, '');
  }

  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
  }

  function isLikelyPhone(phone) {
    const digits = extractPhoneDigits(phone);
    if (!digits) return false;
    if (digits.length > PHONE_MAX_DIGITS) return false;
    if (digits.startsWith('55')) {
      return digits.length >= 12;
    }
    return digits.length >= 10;
  }

  function normalizePhoneValue(raw) {
    const digits = extractPhoneDigits(raw);
    let normalized = digits.startsWith('55') ? digits : `55${digits}`;
    normalized = normalized.replace(/^55+/, '55');
    normalized = normalized.slice(0, PHONE_MAX_DIGITS);
    if (!normalized) return '+55';
    if (normalized === '55') return '+55';
    return `+${normalized}`;
  }

  function hasPhoneDigits(value) {
    const digits = extractPhoneDigits(value);
    if (!digits) return false;
    if (digits.startsWith('55')) {
      return digits.length > 2;
    }
    return digits.length > 0;
  }

  function recipientHasValue(recipient, key) {
    const normalized = normalizeVarKey(key);
    if (normalized === 'name' || normalized === 'nome') {
      return Boolean(recipient.name && recipient.name.trim());
    }
    if (normalized === 'email') {
      return Boolean(recipient.email && recipient.email.trim());
    }
    if (['phone', 'telefone', 'celular', 'whatsapp'].includes(normalized)) {
      return hasPhoneDigits(recipient.phone);
    }
    const value = recipient.vars?.[normalized];
    return value !== undefined && String(value).trim() !== '';
  }

  function extractPlaceholders(textValue) {
    const placeholders = new Map();
    if (!textValue) return placeholders;
    const regex = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
    let match = regex.exec(textValue);
    while (match) {
      const raw = (match[1] || '').trim();
      const normalized = normalizeVarKey(raw);
      if (normalized) {
        if (!placeholders.has(normalized)) {
          placeholders.set(normalized, raw);
        }
      }
      match = regex.exec(textValue);
    }
    return placeholders;
  }

  function placeholdersSatisfied() {
    if (!showFirstContactTemplate.value) {
      placeholderGlobalError.value = '';
      placeholderDaysError.value = '';
      return true;
    }
    const requiredKeys = Array.from(requiredPlaceholders.value || []);
    if (!requiredKeys.length) {
      placeholderGlobalError.value = '';
      placeholderDaysError.value = '';
      return true;
    }

    const missingCounter = new Map(requiredKeys.map(key => [key, 0]));
    form.recipients.forEach(recipient => {
      requiredKeys.forEach(key => {
        if (!recipientHasValue(recipient, key)) {
          missingCounter.set(key, missingCounter.get(key) + 1);
        }
      });
    });

    const missingList = Array.from(missingCounter.entries()).filter(
      ([, count]) => count > 0
    );
    if (!missingList.length) {
      placeholderGlobalError.value = '';
      placeholderDaysError.value = '';
      return true;
    }

    const varsMap = knownVariables.value;
    const message = `Preencha as variáveis requeridas nos destinatários: ${missingList
      .map(([key, count]) => {
        const label = varsMap.get(key)?.raw || key;
        return `${label} (${count})`;
      })
      .join(', ')}.`;

    placeholderGlobalError.value = text.placeholders.global(message);
    placeholderDaysError.value =
      form.channel === 'whatsapp' ? text.placeholders.day(message) : '';

    return false;
  }

  const isValid = computed(() => {
    if (!isNameValid.value) return false;
    if (!form.channel) return false;
    if (!form.recipients.length) return false;

    if (form.channel === 'email') {
      const everyHasEmail = form.recipients.every(recipient =>
        Boolean(recipient.email)
      );
      if (!everyHasEmail) return false;
    } else {
      const everyHasPhone = form.recipients.every(recipient =>
        hasPhoneDigits(recipient.phone)
      );
      if (!everyHasPhone) return false;
      if (!form.agent) return false;
    }

    if (!startDateValue.value || !endDateValue.value) return false;
    if (!validDateRange.value) return false;
    if (!form.daysOfWeek.length) return false;
    if (!isTimeSelectionEnabled.value) return false;
    if (!isTimeValid.value) return false;
    if (!form.timezone) return false;
    if (!placeholdersSatisfied()) return false;

    if (form.channel === 'whatsapp') {
      if (showFirstContactTemplate.value) {
        // Require selecting a first-contact template when the toggle is enabled
        if (!selectedTemplate.value) return false;
      } else {
        const allDaysHaveMessage = form.daysOfWeek.every(day => {
          const content = form.payload?.messagesByDay?.[day] || '';
          return Boolean(content.trim());
        });
        if (!allDaysHaveMessage) return false;
      }
    }

    return true;
  });

  function recomputeRequiredPlaceholders() {
    const details = new Map();

    const addPlaceholder = (normalized, raw) => {
      if (!normalized) return;
      const existing = details.get(normalized) || { raw: raw || normalized };
      if (!existing.raw && raw) {
        existing.raw = raw;
      }
      details.set(normalized, existing);
    };

    if (form.channel === 'email') {
      ['subject', 'text', 'html'].forEach(key => {
        const placeholders = extractPlaceholders(form.payload?.[key]);
        placeholders.forEach((raw, normalized) => addPlaceholder(normalized, raw));
      });
    } else {
      const byDay = form.payload?.messagesByDay || {};
      form.daysOfWeek.forEach(day => {
        const placeholders = extractPlaceholders(byDay[day]);
        placeholders.forEach((raw, normalized) =>
          addPlaceholder(normalized, raw)
        );
      });

      const fallbackMessage = form.payload?.message;
      if (fallbackMessage) {
        const messagePlaceholders = extractPlaceholders(fallbackMessage);
        messagePlaceholders.forEach((raw, normalized) =>
          addPlaceholder(normalized, raw)
        );
      }
    }

    if (showFirstContactTemplate.value) {
      const entriesByComponent = selectedTemplate.value?.placeholderEntries || {};
      Object.values(entriesByComponent).forEach(entries => {
        entries.forEach(({ raw, normalized }) => addPlaceholder(normalized, raw));
      });

      if (!selectedTemplate.value && templateFallback.value?.params) {
        Object.values(templateFallback.value.params).forEach(mapping => {
          Object.keys(mapping || {}).forEach(key => {
            addPlaceholder(normalizeVarKey(key), key);
          });
        });
      }
    }

    requiredPlaceholders.value = new Set(details.keys());
    updateVariableRegistry(details);
    placeholderGlobalError.value = '';
    placeholderDaysError.value = '';
    placeholdersSatisfied();
  }

  function updateVariableRegistry(details) {
    const orderedKeys = Array.from(details.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );

    const nextMap = new Map();
    orderedKeys.forEach(key => {
      if (RESERVED_TEMPLATE_VARIABLES.has(key)) return;
      const info = details.get(key) || {};
      nextMap.set(key, {
        key,
        raw: info.raw || key,
      });
    });

    knownVariables.value = nextMap;
    form.customFields = orderedKeys.filter(key => !RESERVED_TEMPLATE_VARIABLES.has(key));

    form.recipients = form.recipients.map(recipient => {
      const vars = { ...(recipient.vars || {}) };
      orderedKeys.forEach(key => {
        if (RESERVED_TEMPLATE_VARIABLES.has(key)) return;
        if (!Object.prototype.hasOwnProperty.call(vars, key)) {
          vars[key] = '';
        }
      });
      Object.keys(vars).forEach(existingKey => {
        if (!details.has(existingKey) || RESERVED_TEMPLATE_VARIABLES.has(existingKey)) {
          delete vars[existingKey];
        }
      });
      return { ...recipient, vars };
    });
  }

  watch(showFirstContactTemplate, value => {
    if (!value) {
      templateFallback.value = null;
      recomputeRequiredPlaceholders();
    } else {
      if (selectedTemplate.value && !templateFallback.value) {
        templateFallback.value = buildTemplateFallbackObject(selectedTemplate.value);
      }
      recomputeRequiredPlaceholders();
    }
  });

  function resetForm() {
    form.name = '';
    originalName.value = '';
    form.channel = '';
    form.agent = '';
    form.recipients = [];
    form.payload = { message: 'Olá {{name}}!', messagesByDay: {} };
    form.customFields = [];
    form.enabled = true;
    form.daysOfWeek = [];
    form.time = '';
    form.timezone = BRT_TIMEZONE;
    form.startAt = '';
    form.endAt = '';
    selectedTemplateKey.value = '';
    csvReport.value = null;
    status.show = false;
    status.msg = '';
    status.ok = true;
    requiredPlaceholders.value = new Set();
    placeholderGlobalError.value = '';
    placeholderDaysError.value = '';
    templateFallback.value = null;
    knownVariables.value = new Map();
    firstContactAll.value = false;
    dailyWeekdays.value = false;
    initDefaultDates();
    ensureValidTimeSelection();
  }

  function hydrateFromValue(value) {
    if (!value) {
      resetForm();
      originalName.value = '';  // << NOVO
      recomputeRequiredPlaceholders();
      if (form.channel === 'whatsapp' && form.agent) {
        loadTemplates();
      } else {
        templates.value = [];
        selectedTemplateKey.value = '';
      }
      return;
    }

    const incomingName = value.Name || value.name || '';
    form.name = sanitizeScheduleName(incomingName);
    originalName.value = incomingName;
    form.channel = value.Channel || '';
    form.agent = value.Agent || '';
    form.recipients = Array.isArray(value.Recipients)
      ? JSON.parse(JSON.stringify(value.Recipients))
      : [];

    form.recipients = form.recipients.map(recipient => ({
      name: recipient.name || '',
      email: recipient.email,
      phone: normalizePhoneValue(recipient.phone || ''),
      vars: Object.fromEntries(
        Object.entries(recipient.vars || {})
          .map(([key, v]) => [normalizeVarKey(key), v])
          .filter(([key]) => key && !RESERVED_TEMPLATE_VARIABLES.has(key))
      ),
      primeiroContato: Boolean(recipient.primeiroContato),
    }));

    const collected = new Set();
    form.recipients.forEach(recipient => {
      if (recipient && typeof recipient.vars === 'object') {
        Object.keys(recipient.vars).forEach(key =>
          collected.add(normalizeVarKey(key))
        );
      }
    });
    form.customFields = Array.from(collected).filter(
      key => !RESERVED_TEMPLATE_VARIABLES.has(key)
    );

    // Derive global first contact from existing recipients (legacy per-recipient data)
    firstContactAll.value = form.recipients.some(r => Boolean(r.primeiroContato));

    const defaultPayload =
      form.channel === 'email'
        ? { subject: '', text: '', html: '' }
        : { message: 'Olá {{name}}!', messagesByDay: {} };
    const payload = JSON.parse(JSON.stringify(value.Payload || defaultPayload));
    if (form.channel === 'whatsapp' && !payload.messagesByDay) {
      payload.messagesByDay = {};
    }
    form.payload = payload;
    templateFallback.value = value.Payload?.template_fallback || null;

    form.enabled = Boolean(value.Enabled);
    form.startAt = value.StartAt || '';
    form.endAt = value.EndAt || '';
    form.daysOfWeek = Array.isArray(value.DaysOfWeek)
      ? value.DaysOfWeek.slice()
      : [];
    form.time = value.Time || '';
    form.timezone = value.Timezone || BRT_TIMEZONE;
    dailyWeekdays.value =
      form.daysOfWeek.length === WEEKDAYS.length &&
      WEEKDAYS.every(day => form.daysOfWeek.includes(day));

    selectedTemplateKey.value = '';
    csvReport.value = null;
    status.show = false;
    status.msg = '';
    status.ok = true;

    ensureValidTimeSelection();

    nextTick(() => {
      recomputeRequiredPlaceholders();
      if (form.channel === 'whatsapp' && form.agent) {
        loadTemplates();
      } else {
        templates.value = [];
        selectedTemplateKey.value = '';
      }
    });
  }

  async function loadAgents() {
    agentsLoading.value = true;
    try {
      const { data } = await axios.get(AGENTS_API);
      agents.value = Array.isArray(data?.items)
        ? data.items.map(item => {
            const name = item.name || '';
            const phoneLabel = item.label || item.number || '';
            const display =
              name && phoneLabel ? `${name} - ${phoneLabel}` : name || phoneLabel;
            return {
              id: item.id,
              name,
              label: display,
              number: item.number,
            };
          })
        : [];
    } catch (_e) {
      useAlert(text.alerts.agents);
    } finally {
      agentsLoading.value = false;
    }
  }

  async function loadTemplates() {
    if (form.channel !== 'whatsapp' || !form.agent) {
      templates.value = [];
      selectedTemplateKey.value = '';
      templateFallback.value = null;
      return;
    }
    templatesLoading.value = true;
    templates.value = [];
    try {
      const params = new URLSearchParams();
      params.set('agent', form.agent);
      const { data } = await axios.get(`${TEMPLATES_API}?${params.toString()}`);
      const inboxId = data?.inbox_id ? Number(data.inbox_id) : null;
      const rawItems = Array.isArray(data?.items) ? data.items : [];

      const flattened = [];

      const pushTemplate = (template, index = 0) => {
        if (!template) return;
        const components = template.components || [];
        const preview =
          combineTemplateTextFromComponents(components) ||
          template.text ||
          template.content ||
          '';
        const placeholderInfo = extractPlaceholdersFromComponents(components);
        const language = template.language || template.language_code || '';
        const name = template.name || '';
        const category = template.category || template.type || '';
      const tplStatus = template.status || '';
      flattened.push({
          key: `${name || 'template'}::${language || 'und'}::${flattened.length}-${index}`,
          name,
          title: `${name}${language ? ` (${language})` : ''}`,
          text: preview,
          language,
          category,
          status: tplStatus,
          placeholders: placeholderInfo.flat,
          placeholderEntries: placeholderInfo.byComponent,
          parameterFormat:
            (template.parameter_format || template.parameterFormat || '')
              .toUpperCase() || '',
          raw: template,
        });
      };

      rawItems.forEach(item => {
        const source = item?.raw || item;
        const sourceInboxId = source?.id ? Number(source.id) : null;
        if (inboxId && sourceInboxId && sourceInboxId !== inboxId) {
          return;
        }
        const messageTemplates = source?.message_templates;
        if (Array.isArray(messageTemplates) && messageTemplates.length) {
          messageTemplates.forEach((tpl, idx) => pushTemplate(tpl, idx));
        } else {
          pushTemplate(item, 0);
        }
      });

      templates.value = flattened;

      if (!flattened.length) {
        templateFallback.value = null;
        selectedTemplateKey.value = '';
      } else if (templateFallback.value?.name) {
        const matched = flattened.find(template => {
          if (template.name !== templateFallback.value.name) return false;
          if (templateFallback.value.language && template.language) {
            return template.language === templateFallback.value.language;
          }
          return true;
        });
        selectedTemplateKey.value = matched?.key || '';
      } else {
        selectedTemplateKey.value = '';
      }
      nextTick(recomputeRequiredPlaceholders);
    } catch (_e) {
      useAlert(text.alerts.templates);
    } finally {
      templatesLoading.value = false;
    }
  }

  async function syncTemplates() {
    if (form.channel !== 'whatsapp' || !form.agent) return;
    templatesLoading.value = true;
    try {
      const params = new URLSearchParams();
      params.set('agent', form.agent);
      params.set('sync', '1');
      await axios.get(`${TEMPLATES_API}?${params.toString()}`);
      await loadTemplates();
      useAlert(text.alerts.syncSuccess);
    } catch (_e) {
      useAlert(text.alerts.syncError);
    } finally {
      templatesLoading.value = false;
    }
  }

  function applyTemplate() {
    if (!selectedTemplate.value) return;
    form.payload.message = selectedTemplate.value.text || '';
    templateFallback.value = buildTemplateFallbackObject(selectedTemplate.value);
    nextTick(recomputeRequiredPlaceholders);
  }

  function addRecipient() {
    const variableKeys = Array.from(knownVariables.value.keys());
    const vars = Object.fromEntries(variableKeys.map(key => [key, '']));
    form.recipients = [
      ...form.recipients,
      {
        name: '',
        phone: form.channel === 'whatsapp' ? '+55' : undefined,
        email: form.channel === 'email' ? '' : undefined,
        vars,
        primeiroContato: Boolean(firstContactAll.value),
      },
    ];
    nextTick(recomputeRequiredPlaceholders);
  }

  function onRecipientPhoneInput(index, event) {
    const raw = event?.target?.value ?? '';
    const masked = normalizePhoneValue(raw);
    if (event?.target && event.target.value !== masked) {
      event.target.value = masked;
    }
    if (!form.recipients[index]) return;
    form.recipients[index].phone = masked;
  }

  function onRecipientPhoneFocus(index, event) {
    const recipient = form.recipients[index];
    if (!recipient) return;
    if (!hasPhoneDigits(recipient.phone)) {
      const defaultValue = '+55';
      if (event?.target) {
        event.target.value = defaultValue;
        const len = defaultValue.length;
        event.target.setSelectionRange?.(len, len);
      }
      recipient.phone = defaultValue;
      return;
    }
    const normalized = normalizePhoneValue(recipient.phone);
    if (recipient.phone !== normalized) {
      recipient.phone = normalized;
    }
    if (event?.target && event.target.value !== normalized) {
      event.target.value = normalized;
      const len = normalized.length;
      event.target.setSelectionRange?.(len, len);
    }
  }

  function onRecipientPhoneBlur(index) {
    const recipient = form.recipients[index];
    if (!recipient) return;
    if (!hasPhoneDigits(recipient.phone)) {
      recipient.phone = '';
      return;
    }
    recipient.phone = normalizePhoneValue(recipient.phone);
  }

  function removeRecipient(index) {
    form.recipients = form.recipients.filter(
      (_, recipientIndex) => recipientIndex !== index
    );
    nextTick(recomputeRequiredPlaceholders);
  }

  function detectDelimiter(headerLine) {
    const commaCount = (headerLine.match(/,/g) || []).length;
    const semicolonCount = (headerLine.match(/;/g) || []).length;
    return semicolonCount > commaCount ? ';' : ',';
  }

  function parseCsvText(textValue) {
    const lines = textValue.split(/\r?\n/).filter(line => line.trim() !== '');
    if (!lines.length) return { headers: [], rows: [], originalHeaders: [] };
    const delimiter = detectDelimiter(lines[0]);
    const split = line => {
      const output = [];
      let buffer = '';
      let inQuotes = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === '"') {
          if (line[index + 1] === '"') {
            buffer += '"';
            index += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === delimiter && !inQuotes) {
          output.push(buffer);
          buffer = '';
        } else {
          buffer += char;
        }
      }
      output.push(buffer);
      return output.map(cell => cell.trim());
    };

    const originalHeaders = split(lines[0]);
    const headers = originalHeaders.map(normalizeHeader);
    const rows = lines.slice(1).map(split);
    return { headers, rows, originalHeaders };
  }

  function handleCsvUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const textValue = reader.result?.toString() || '';
        const { headers, rows, originalHeaders } = parseCsvText(textValue);
        if (!headers.length || !rows.length) {
          csvReport.value = { ok: false, msg: text.recipients.csv.empty };
          return;
        }

        const headerIndex = new Map(
          headers.map((header, index) => [header, index])
        );
        const nameKey = ['name', 'nome'].find(key => headerIndex.has(key));
        const emailKey = ['email', 'e-mail', 'e_mail'].find(key =>
          headerIndex.has(key)
        );
        const phoneKey = ['phone', 'telefone', 'celular', 'whatsapp'].find(key =>
          headerIndex.has(key)
        );
        const needsEmail = form.channel === 'email';
        const hasRequiredHeaders = needsEmail
          ? nameKey && emailKey
          : nameKey && phoneKey;
        if (!hasRequiredHeaders) {
          csvReport.value = {
            ok: false,
            msg: needsEmail
              ? text.recipients.csv.invalidEmail
              : text.recipients.csv.invalidWhatsapp,
          };
          return;
        }

        const knownHeaders = new Set(
          [nameKey, emailKey, phoneKey].filter(Boolean)
        );
        const variableColumns = headers
          .map((header, index) => ({ header, index }))
          .filter(({ header }) => header && !knownHeaders.has(header));

        const existingKeys = new Set(
          form.recipients
            .map(recipient => {
              if (needsEmail) return recipient.email?.toLowerCase();
              if (!hasPhoneDigits(recipient.phone)) return null;
              return normalizePhoneValue(recipient.phone);
            })
            .filter(Boolean)
        );

        let imported = 0;
        let skipped = 0;
        const freshRecipients = [];

        rows.forEach(row => {
          const name = row[headerIndex.get(nameKey)]?.trim();
          const email = emailKey ? row[headerIndex.get(emailKey)]?.trim() : '';
          const phone = phoneKey ? row[headerIndex.get(phoneKey)]?.trim() : '';

        if (!name && !email && !phone) {
            skipped += 1;
            return;
          }

          const vars = Object.fromEntries(
            variableColumns.map(({ index, header }) => [
              normalizeVarKey(originalHeaders[index] || header),
              (row[index] || '').trim(),
            ])
          );

          if (needsEmail) {
            if (!email || !isValidEmail(email)) {
              skipped += 1;
              return;
            }
            const key = email.toLowerCase();
            if (existingKeys.has(key)) {
              skipped += 1;
              return;
            }
            existingKeys.add(key);
            freshRecipients.push({
              name,
              email,
              vars,
              primeiroContato: Boolean(firstContactAll.value),
            });
            imported += 1;
          } else {
            if (!phone || !isLikelyPhone(phone)) {
              skipped += 1;
              return;
            }
            const normalizedPhone = normalizePhoneValue(phone);
            if (!hasPhoneDigits(normalizedPhone)) {
              skipped += 1;
              return;
            }
            if (existingKeys.has(normalizedPhone)) {
              skipped += 1;
              return;
            }
            existingKeys.add(normalizedPhone);
            freshRecipients.push({
              name,
              phone: normalizedPhone,
              vars,
              primeiroContato: Boolean(firstContactAll.value),
            });
            imported += 1;
          }
        });

        form.recipients = [...form.recipients, ...freshRecipients];
        csvReport.value = {
          ok: true,
          msg: text.recipients.csv.summary(
            imported,
            skipped,
            form.recipients.length
          ),
        };
        event.target.value = '';
        nextTick(recomputeRequiredPlaceholders);
      } catch (_e) {
        csvReport.value = { ok: false, msg: text.recipients.csv.error };
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  function downloadCsvTemplate() {
    const needsEmail = form.channel === 'email';
    const baseHeaders = needsEmail ? ['name', 'email'] : ['name', 'phone'];
    const baseRows = needsEmail
      ? [
          ['Ana', 'ana@exemplo.com'],
          ['Bruno', 'bruno@exemplo.com'],
        ]
      : [
          ['Ana', '+5532987654321'],
          ['Bruno', '+5531999999999'],
        ];

    const includeTemplateVars =
      form.channel === 'whatsapp' &&
      showFirstContactTemplate.value &&
      (selectedTemplate.value || templateFallback.value);

    const templateHeaders = [];
    if (includeTemplateVars) {
      const skipKeys = new Set(baseHeaders.map(header => normalizeVarKey(header)));
      const seen = new Set();
      const resolveLabel = normalizedKey => {
        const store = knownVariables.value;
        if (store && typeof store.get === 'function') {
          const info = store.get(normalizedKey);
          if (info?.raw) return info.raw;
        }
        return normalizedKey;
      };
      const addHeader = (normalized, raw) => {
        if (!normalized) return;
        const normalizedKey = normalizeVarKey(normalized);
        if (!normalizedKey) return;
        if (
          RESERVED_TEMPLATE_VARIABLES.has(normalizedKey) ||
          skipKeys.has(normalizedKey) ||
          seen.has(normalizedKey)
        )
          return;
        seen.add(normalizedKey);
        const label = raw || resolveLabel(normalizedKey);
        templateHeaders.push({ key: normalizedKey, label });
      };

      const template = selectedTemplate.value;
      if (template?.placeholderEntries) {
        Object.values(template.placeholderEntries).forEach(entries => {
          entries.forEach(({ raw, normalized }) => addHeader(normalized, raw));
        });
      }

      if (!template && templateFallback.value?.params) {
        Object.values(templateFallback.value.params).forEach(mapping => {
          Object.values(mapping || {}).forEach(value => {
            const match = /{{\s*vars\.([a-zA-Z0-9_.-]+)\s*}}/i.exec(value || '');
            if (match) addHeader(match[1]);
          });
        });
      }
    }

    const headers = [...baseHeaders, ...templateHeaders.map(item => item.label)];
    const rows = baseRows.map((row, rowIndex) => {
      if (!templateHeaders.length) return row;
      const extras = templateHeaders.map((item, extraIndex) => {
        const base = (item.label || item.key || `var${extraIndex + 1}`)
          .toString()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '');
        const suffix = base || `var${extraIndex + 1}`;
        return `valor_${suffix}_${rowIndex + 1}`;
      });
      return [...row, ...extras];
    });

    const csv = [
      headers.join(','),
      ...rows.map(row =>
        row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')
      ),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = needsEmail
      ? 'recipients_email_template.csv'
      : 'recipients_whatsapp_template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
  }

  function deriveEnabledFromPeriod() {
    const now = new Date();
    const start = form.startAt ? new Date(form.startAt) : null;
    const end = form.endAt ? new Date(form.endAt) : null;
    const okStart = !start || !Number.isNaN(start.getTime());
    const okEnd = !end || !Number.isNaN(end?.getTime());

    if (!okStart && !okEnd) return true;
    if (okStart && okEnd && start && end) return now >= start && now <= end;
    if (okStart && start && (!end || !okEnd)) return now >= start;
    if (okEnd && end && (!start || !okStart)) return now <= end;
    return true;
  }

  function buildPayload() {
    const injectReservedNameVar = requiredPlaceholders.value.has('name');

    const recipientsPayload = form.recipients.map(recipient => {
      const baseVars = { ...(recipient.vars || {}) };
      if (injectReservedNameVar) {
        baseVars.name = recipient.name || '';
      }

      return {
        name: recipient.name || '',
        email: recipient.email,
        phone: hasPhoneDigits(recipient.phone)
          ? normalizePhoneValue(recipient.phone)
          : '',
        vars: baseVars,
        primeiroContato: Boolean(firstContactAll.value),
      };
    });

    const templateFallbackPayload =
      form.channel === 'whatsapp' && showFirstContactTemplate.value && templateFallback.value
        ? JSON.parse(JSON.stringify(templateFallback.value))
        : null;

    let channelPayload;
    if (form.channel === 'email') {
      channelPayload = {
        subject: form.payload?.subject || text.content.subjectPlaceholder,
        text: form.payload?.text || '',
        html: form.payload?.html || '',
      };
    } else {
      channelPayload = {
        messagesByDay: form.daysOfWeek.reduce((acc, day) => {
          const value = (form.payload?.messagesByDay?.[day] || '').trim();
          if (value) acc[day] = value;
          return acc;
        }, {}),
      };

      if (templateFallbackPayload) {
        channelPayload.template_fallback = templateFallbackPayload;
      }
      const fallbackMessage = (form.payload?.message || '').trim();
      if (fallbackMessage) {
        channelPayload.message = fallbackMessage;
      }
    }

    const base = {
      name: form.name,
      channel: form.channel,
      agent: form.channel === 'whatsapp' ? form.agent || undefined : undefined,
      recipients: recipientsPayload,
      payload: channelPayload,
      enabled: deriveEnabledFromPeriod(),
      startAt: form.startAt?.trim() || undefined,
      endAt: form.endAt?.trim() || undefined,
    };

    return {
      ...base,
      daysOfWeek: form.daysOfWeek,
      time: form.time,
      timezone: form.timezone || BRT_TIMEZONE,
    };
  }

  async function submit() {
    if (!isValid.value || submitting.value) return;
    submitting.value = true;
    status.show = false;
    try {
      const payload = buildPayload();
      if (isEdit.value) {
        await api.put(`/${encodeURIComponent(originalName.value)}`, payload); // << ALTERADO
        status.show = true;
        status.ok = true;
        status.msg = text.status.updated;
      } else {
        await api.post('', payload);
        status.show = true;
        status.ok = true;
        status.msg = text.status.created;
      }
      emit('saved');
    } catch (_e) {
      status.show = true;
      status.ok = false;
      status.msg = text.status.error;
    } finally {
      submitting.value = false;
    }
  }

  watch(
    () => props.value,
    newValue => {
      hydrateFromValue(newValue);
    },
    { immediate: true }
  );

  watch(
    () => form.name,
    value => {
      const sanitized = sanitizeScheduleName(value);
      if (value !== sanitized) {
        form.name = sanitized;
      }
    }
  );

  // Define WhatsApp as the default channel once the dropdown becomes enabled
  // (i.e., after the "Nome do agendamento" is filled and canSelectChannel becomes true)
  watch(
    canSelectChannel,
    enabled => {
      if (enabled && !form.channel) {
        form.channel = 'whatsapp';
      }
    }
  );

  watch(
    () => form.channel,
    channel => {
      if (!channel) {
        form.agent = '';
        form.recipients = form.recipients.map(recipient => ({
          name: recipient.name || '',
          email: undefined,
          phone: undefined,
          vars: Object.fromEntries(
            Object.entries(recipient.vars || {}).map(([key, v]) => [
              normalizeVarKey(key),
              v,
            ])
          ),
          primeiroContato: Boolean(recipient.primeiroContato),
        }));
        form.payload = { message: 'Olá {{name}}!', messagesByDay: {} };
        templates.value = [];
        selectedTemplateKey.value = '';
        templateFallback.value = null;
        return;
      }
      form.recipients = form.recipients.map(recipient => ({
        name: recipient.name || '',
        email: channel === 'email' ? recipient.email || '' : undefined,
        phone:
          channel === 'whatsapp'
            ? normalizePhoneValue(recipient.phone || '')
            : undefined,
        vars: Object.fromEntries(
          Object.entries(recipient.vars || {}).map(([key, v]) => [
            normalizeVarKey(key),
            v,
          ])
        ),
        primeiroContato: Boolean(recipient.primeiroContato),
      }));

      if (channel === 'email') {
        form.payload = {
          subject: form.payload.subject || '',
          text: form.payload.text || '',
          html: form.payload.html || '',
        };
        templates.value = [];
        selectedTemplateKey.value = '';
        templateFallback.value = null;
      } else {
        form.payload = {
          message: form.payload.message || 'Olá {{name}}!',
          messagesByDay: form.payload.messagesByDay || {},
        };
        if (form.agent) {
          loadTemplates();
        } else {
          templates.value = [];
          selectedTemplateKey.value = '';
        }
      }

      nextTick(recomputeRequiredPlaceholders);
    }
  );

  watch(
    () => form.daysOfWeek.slice(),
    days => {
      if (form.channel !== 'whatsapp') return;
      const messagesByDay = { ...(form.payload.messagesByDay || {}) };
      days.forEach(day => {
        if (!Object.prototype.hasOwnProperty.call(messagesByDay, day)) {
          messagesByDay[day] = '';
        }
      });
      Object.keys(messagesByDay).forEach(day => {
        if (!days.includes(day)) {
          delete messagesByDay[day];
        }
      });
      form.payload.messagesByDay = messagesByDay;
      nextTick(recomputeRequiredPlaceholders);
    }
  );

  watch(dailyWeekdays, val => {
    if (val) {
      form.daysOfWeek = WEEKDAYS.slice();
    } else {
      // Ao desmarcar "Disparo diário (úteis)", limpamos a seleção de dias
      form.daysOfWeek = [];
    }
  });

  watch(startDateValue, () => {
    ensureValidTimeSelection();
  });

  watch(availableTimeOptions, () => {
    ensureValidTimeSelection();
  });

  watch(
    () => form.agent,
    value => {
      if (form.channel !== 'whatsapp') return;
      if (value) {
        loadTemplates();
      } else {
        templates.value = [];
        selectedTemplateKey.value = '';
        templateFallback.value = null;
        recomputeRequiredPlaceholders();
      }
    }
  );

  watch(
    () => selectedTemplate.value,
    template => {
      if (template) {
        templateFallback.value = buildTemplateFallbackObject(template);
      } else if (templates.value.length && !selectedTemplateKey.value) {
        templateFallback.value = null;
      }
      if (showFirstContactTemplate.value) {
        nextTick(recomputeRequiredPlaceholders);
      }
    }
  );

  let nowIntervalId = null;

  onMounted(() => {
    loadAgents();
    if (form.channel === 'whatsapp' && form.agent) loadTemplates();
    initDefaultDates();
    ensureValidTimeSelection();
    recomputeRequiredPlaceholders();
    nowIntervalId = setInterval(() => {
      nowState.value = getNowInTimezone(BRT_TIMEZONE);
    }, 60000);
  });

  onBeforeUnmount(() => {
    if (nowIntervalId) {
      clearInterval(nowIntervalId);
      nowIntervalId = null;
    }
  });

  return {
    // constants/text
    text,
    DAYS_OF_WEEK,

    // state
    agents,
    agentsLoading,
    templates,
    templatesLoading,
    selectedTemplateKey,
    form,
    dailyWeekdays,
    firstContactAll,
    submitting,
    status,
    csvReport,
    requiredPlaceholders,
    knownVariables,
    placeholderGlobalError,
    placeholderDaysError,
    templateFallback,

    // computed
    startDateTimeInput,
    endDateTimeInput,
    startDateTimeMin,
    endDateTimeMin,
    isStartDateInPast,
    availableTimeOptions,
    isTimeSelectionEnabled,
    timeError,
    isTimeValid,
    isEdit,
    isNameFilled,
    isNameValid,
    nameError,
    canSelectChannel,
    canSelectAgent,
    validDateRange,
    selectedTemplate,
    showFirstContactTemplate,
    variableEntries,
    variableLabelMap,
    isValid,

    // methods
    recomputeRequiredPlaceholders,
    updateVariableRegistry,
    resetForm,
    hydrateFromValue,
    loadAgents,
    loadTemplates,
    syncTemplates,
    applyTemplate,
    addRecipient,
    onRecipientPhoneInput,
    onRecipientPhoneFocus,
    onRecipientPhoneBlur,
    removeRecipient,
    detectDelimiter,
    parseCsvText,
    handleCsvUpload,
    downloadCsvTemplate,
    buildPayload,
    submit,
  };
}
