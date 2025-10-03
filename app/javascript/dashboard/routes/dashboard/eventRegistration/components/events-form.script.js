import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { useAlert } from 'dashboard/composables';

export function useEventsForm(props, emit) {
  // #region Constants & Helpers
  const API_BASE =
    'https://f4wzfjousg.execute-api.us-east-1.amazonaws.com/schedules';
  const AGENTS_API =
    'https://f4wzfjousg.execute-api.us-east-1.amazonaws.com/get-agents-list';
  const TEMPLATES_API =
    'https://f4wzfjousg.execute-api.us-east-1.amazonaws.com/get-whatsapp-templates-list';

  const DAYS_OF_WEEK = Object.freeze([
    { value: 'MON', label: 'Segunda' },
    { value: 'TUE', label: 'Terça' },
    { value: 'WED', label: 'Quarta' },
    { value: 'THU', label: 'Quinta' },
    { value: 'FRI', label: 'Sexta' },
    { value: 'SAT', label: 'Sábado' },
    { value: 'SUN', label: 'Domingo' },
  ]);
  const WEEKDAYS = Object.freeze(['MON', 'TUE', 'WED', 'THU', 'FRI']);
  const BRT_TIMEZONE = 'America/Sao_Paulo';
  const MIN_FUTURE_MINUTES = 3;
  const NAME_ALLOWED_REGEX = /^[A-Za-z0-9_-]+$/;
  const PHONE_MAX_DIGITS = 13;
  const RESERVED_TEMPLATE_VARIABLES = new Set(['name']);
  const pad = value => String(value).padStart(2, '0');
  const buildTimeOptions = (step = 5) =>
    Array.from({ length: Math.floor((24 * 60) / step) }, (_, index) => {
      const total = index * step;
      return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    });
  const TIME_OPTIONS = Object.freeze(buildTimeOptions(5));
  const onlyDigits = value => (value || '').replace(/\D/g, '');
  const expandScientificNotation = raw => {
    const normalized = (raw ?? '').toString().trim().replace(',', '.');
    if (!normalized) return '';
    const match = /^([-+]?\d+(?:\.\d+)?)e\+?(\d+)$/i.exec(normalized);
    if (!match) return normalized;
    const [, mantissa, exponentString] = match;
    const exponent = Number(exponentString);
    if (!Number.isFinite(exponent)) return normalized;
    const sign = mantissa.startsWith('-') ? '-' : '';
    const unsigned = mantissa.replace(/^[+-]/, '');
    const [integerPart, fractionalPart = ''] = unsigned.split('.');
    const digits = integerPart + fractionalPart;
    const shift = exponent - fractionalPart.length;
    if (shift >= 0) return sign + digits + '0'.repeat(shift);
    const splitIndex = digits.length + shift;
    if (splitIndex <= 0) return `${sign}0.${'0'.repeat(-splitIndex)}${digits}`;
    return `${sign}${digits.slice(0, splitIndex)}.${digits.slice(splitIndex)}`;
  };
  const extractPhoneDigits = raw => onlyDigits(expandScientificNotation(raw));

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

  const normalizeVarKey = value => {
    const trimmed = (value || '').toString().trim();
    const positional = /^var(\d+)$/i.exec(trimmed);
    return positional ? positional[1] : trimmed.toLowerCase().replace(/[^a-z0-9_.-]/g, '_');
  };

  // #endregion Constants & Helpers

  // #region Text Resources

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
      title: 'Variáveis Personalizadas',
      empty:
        'Nenhuma variável detectada. Use {{variavel}} nas mensagens para adicioná-las automaticamente.',
      valuePlaceholder: 'Preencha o valor',
      headerNote: '* Variáveis do cabeçalho do template',
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
      templatePlaceholders: 'Variáveis do template por componente:',
      templatePlaceholdersHeader: 'Cabeçalho:',
      templatePlaceholdersBody: 'Corpo:',
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
      startPlaceholder: '2025-09-01',
      end: 'Dt. de Fim:',
      endPlaceholder: '2025-12-31',
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

  // #endregion Text Resources

  // #region Reactive State

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

  // #endregion Reactive State

  // #region Computed State & Date Sync

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

  const startDateInput = ref('');
  const endDateInput = ref('');

  const startDateValue = computed(() => {
    if (!form.startAt) return '';
    return isoDateInTimezone(form.startAt, form.timezone || BRT_TIMEZONE);
  });
  const endDateValue = computed(() => {
    if (!form.endAt) return '';
    return isoDateInTimezone(form.endAt, form.timezone || BRT_TIMEZONE);
  });

  const startDateMin = computed(() => nowState.value.date);
  const endDateMin = computed(() =>
    startDateInput.value ? startDateInput.value : nowState.value.date
  );

  const isStartDateInPast = computed(() => {
    if (!startDateInput.value) return false;
    return startDateInput.value < startDateMin.value;
  });

  const validDateRange = computed(() => {
    if (isStartDateInPast.value) return false;
    if (!startDateInput.value || !endDateInput.value) return true;
    return endDateInput.value >= startDateInput.value;
  });
  const initDefaultDates = () => {
    const today = nowState.value.date;
    if (!form.startAt)
      form.startAt = toUtcIsoFromDate(today, '00:00:00', form.timezone || BRT_TIMEZONE);
    if (!form.endAt)
      form.endAt = toUtcIsoFromDate(today, '23:59:59', form.timezone || BRT_TIMEZONE);
  };

  watch(
    () => form.startAt,
    iso => {
      const display = isoDateInTimezone(iso, form.timezone || BRT_TIMEZONE);
      if (startDateInput.value !== display) startDateInput.value = display;
    },
    { immediate: true }
  );

  watch(
    () => form.endAt,
    iso => {
      const display = isoDateInTimezone(iso, form.timezone || BRT_TIMEZONE);
      if (endDateInput.value !== display) endDateInput.value = display;
    },
    { immediate: true }
  );
  watch(startDateInput, value => {
    if (!value) return (form.startAt = '');
    const normalized = value < startDateMin.value ? startDateMin.value : value;
    if (startDateInput.value !== normalized) return (startDateInput.value = normalized);
    const iso = toUtcIsoFromDate(normalized, '00:00:00', form.timezone || BRT_TIMEZONE);
    if (form.startAt !== iso) form.startAt = iso;
    if (!endDateInput.value || endDateInput.value < normalized) {
      endDateInput.value = normalized;
      const alignedIso = toUtcIsoFromDate(normalized, '23:59:59', form.timezone || BRT_TIMEZONE);
      if (form.endAt !== alignedIso) form.endAt = alignedIso;
    }
    ensureValidTimeSelection();
  });
  watch(endDateInput, value => {
    if (!value) return (form.endAt = '');
    const min = endDateMin.value;
    const normalized = value < min ? min : value;
    if (endDateInput.value !== normalized) return (endDateInput.value = normalized);
    const iso = toUtcIsoFromDate(normalized, '23:59:59', form.timezone || BRT_TIMEZONE);
    if (form.endAt !== iso) form.endAt = iso;
  });
  watch(
    () => form.timezone,
    () => {
      const tz = form.timezone || BRT_TIMEZONE;
      startDateInput.value = form.startAt
        ? isoDateInTimezone(form.startAt, tz)
        : '';
      endDateInput.value = form.endAt ? isoDateInTimezone(form.endAt, tz) : '';
      ensureValidTimeSelection();
    }
  );
  watch(startDateMin, minValue => {
    if (startDateInput.value && startDateInput.value < minValue) startDateInput.value = minValue;
  });
  watch(endDateMin, minValue => {
    if (endDateInput.value && endDateInput.value < minValue) endDateInput.value = minValue;
  });

  const selectedTemplate = computed(
    () => templates.value.find(template => template.key === selectedTemplateKey.value) || null
  );
  const showFirstContactTemplate = computed(() => Boolean(firstContactAll.value));
  const availableTimeOptions = computed(() => {
    if (!startDateValue.value) return [];
    const minMinutes = startDateValue.value === nowState.value.date
      ? nowState.value.minutes + MIN_FUTURE_MINUTES
      : 0;
    return TIME_OPTIONS.filter(option => {
      const value = minutesFromHM(option);
      return value != null && value >= minMinutes;
    });
  });
  const hasAvailableTimes = computed(() => availableTimeOptions.value.length > 0);
  const isTimeSelectionEnabled = computed(() => Boolean(startDateValue.value) && hasAvailableTimes.value);
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

  const ensureValidTimeSelection = () => {
    if (!startDateValue.value) return (form.time = '');
    const options = availableTimeOptions.value;
    if (!options.length) return (form.time = '');
    if (!form.time || !options.includes(form.time)) return (form.time = options[0]);
    const currentMinutes = minutesFromHM(form.time);
    const minMinutes = startDateValue.value === nowState.value.date
      ? nowState.value.minutes + MIN_FUTURE_MINUTES
      : 0;
    if (currentMinutes != null && currentMinutes < minMinutes) form.time = options[0];
  };

  const variableEntries = computed(() => {
    const list = [];
    const componentMap = new Map();

    if (selectedTemplate.value?.placeholderEntries) {
      Object.entries(selectedTemplate.value.placeholderEntries).forEach(
        ([component, entries]) => {
          (entries || []).forEach(({ normalized }) => {
            if (!normalized) return;
            if (!componentMap.has(normalized)) componentMap.set(normalized, component);
          });
        }
      );
    } else if (templateFallback.value?.params) {
      Object.entries(templateFallback.value.params).forEach(([component, mapping]) => {
        Object.entries(mapping || {}).forEach(([, value]) => {
          const match = /{{\s*vars\.([a-zA-Z0-9_.-]+)\s*}}/i.exec(value || '');
          if (!match?.[1]) return;
          const normalized = normalizeVarKey(match[1]);
          if (normalized && !componentMap.has(normalized)) componentMap.set(normalized, component);
        });
      });
    }

    knownVariables.value.forEach((info, key) => {
      if (RESERVED_TEMPLATE_VARIABLES.has(key)) return;
      list.push({
        key,
        label: info.raw || key,
        component: componentMap.get(key) || null,
      });
    });

    return list;
  });

  const hasHeaderVars = computed(() => {
    if (selectedTemplate.value?.placeholderEntries) {
      return Object.prototype.hasOwnProperty.call(
        selectedTemplate.value.placeholderEntries,
        'header'
      );
    }
    if (templateFallback.value?.params) {
      return Object.prototype.hasOwnProperty.call(templateFallback.value.params, 'header');
    }
    return false;
  });

  const hasBodyVars = computed(() => {
    if (selectedTemplate.value?.placeholderEntries) {
      return Object.prototype.hasOwnProperty.call(
        selectedTemplate.value.placeholderEntries,
        'body'
      );
    }
    if (templateFallback.value?.params) {
      return Object.prototype.hasOwnProperty.call(templateFallback.value.params, 'body');
    }
    return false;
  });

  const variableLabelMap = computed(() => {
    const map = {};
    knownVariables.value.forEach((info, key) => {
      if (!RESERVED_TEMPLATE_VARIABLES.has(key)) map[key] = info.raw || key;
    });
    return map;
  });

  // #endregion Computed State & Date Sync

  // #region Template & Recipient Helpers

  const TEMPLATE_PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

  const combineTemplateTextFromComponents = components =>
    (components || [])
      .filter(component => {
        const type = (component?.type || '').toUpperCase();
        if (type === 'HEADER') return (component?.format || '').toUpperCase() === 'TEXT';
        return type === 'BODY' || type === 'FOOTER';
      })
      .map(component => component?.text || '')
      .filter(Boolean)
      .join('\n\n');

  const extractPlaceholdersFromComponents = components => {
    const flat = [];
    const byComponent = {};
    (components || []).forEach(component => {
      const type = (component?.type || '').toLowerCase();
      const textVal = component?.text || '';
      if (!textVal) return;
      const entries = [];
      textVal.replace(TEMPLATE_PLACEHOLDER_REGEX, (_match, rawKey) => {
        const raw = (rawKey || '').trim();
        const positional = /^var(\d+)$/i.exec(raw);
        const normalized = positional ? positional[1] : normalizeVarKey(raw);
        if (!normalized) return '';
        entries.push({ raw, normalized, component: type });
        if (!flat.includes(normalized)) flat.push(normalized);
        return '';
      });
      if (entries.length) byComponent[type] = entries;
    });
    return { flat, byComponent };
  };

  const buildTemplateFallbackObject = template => {
    if (!template) return null;
    const fallback = {
      name: template.name,
      language: template.language,
      category: template.category,
      ...(template.parameterFormat ? { parameter_format: template.parameterFormat } : {}),
    };
    const params = {};
    Object.entries(template.placeholderEntries || {}).forEach(([component, entries]) => {
      const mapping = {};
      (entries || []).forEach(({ raw, normalized }) => {
        if (!normalized) return;
        const positional = /^var(\d+)$/.exec(raw);
        const paramKey = positional ? positional[1] : raw;
        mapping[paramKey] = `{{vars.${normalized}}}`;
      });
      if (Object.keys(mapping).length) params[component] = mapping;
    });
    if (Object.keys(params).length) fallback.params = params;
    return fallback;
  };

  const normalizeHeader = value =>
    (value || '')
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9_ -]/g, '');

  const isValidEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');

  const isLikelyPhone = phone => {
    const digits = extractPhoneDigits(phone);
    if (!digits || digits.length > PHONE_MAX_DIGITS) return false;
    return digits.startsWith('55') ? digits.length >= 12 : digits.length >= 10;
  };

  const normalizePhoneValue = raw => {
    const digits = extractPhoneDigits(raw);
    const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
    const normalized = withCountry.replace(/^55+/, '55').slice(0, PHONE_MAX_DIGITS);
    if (!normalized || normalized === '55') return '+55';
    return `+${normalized}`;
  };

  const hasPhoneDigits = value => {
    const digits = extractPhoneDigits(value);
    if (!digits) return false;
    return digits.startsWith('55') ? digits.length > 2 : digits.length > 0;
  };

  const recipientHasValue = (recipient, key) => {
    const normalized = normalizeVarKey(key);
    if (normalized === 'name' || normalized === 'nome') return Boolean(recipient.name?.trim());
    if (normalized === 'email') return Boolean(recipient.email?.trim());
    if (['phone', 'telefone', 'celular', 'whatsapp'].includes(normalized)) return hasPhoneDigits(recipient.phone);
    const value = recipient.vars?.[normalized];
    return value !== undefined && String(value).trim() !== '';
  };

  const sanitizeRecipientVars = vars =>
    Object.fromEntries(
      Object.entries(vars || {})
        .map(([key, value]) => [normalizeVarKey(key), value])
        .filter(([key]) => key && !RESERVED_TEMPLATE_VARIABLES.has(key))
    );

  const normalizeRecipientForChannel = (recipient, channel) => ({
    name: recipient.name || '',
    email: channel === 'email' ? recipient.email || '' : undefined,
    phone: channel === 'whatsapp' ? normalizePhoneValue(recipient.phone || '') : undefined,
    vars: sanitizeRecipientVars(recipient.vars),
    primeiroContato: Boolean(recipient.primeiroContato),
  });

  const normalizeRecipientsForChannel = (recipients, channel) =>
    recipients.map(recipient => ({
      ...normalizeRecipientForChannel(recipient, channel),
      vars: sanitizeRecipientVars(recipient.vars),
    }));

  const extractPlaceholders = textValue => {
    const placeholders = new Map();
    if (!textValue) return placeholders;
    textValue.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, rawKey) => {
      const raw = (rawKey || '').trim();
      const normalized = normalizeVarKey(raw);
      if (normalized && !placeholders.has(normalized)) placeholders.set(normalized, raw);
      return '';
    });
    return placeholders;
  };

  const placeholdersSatisfied = () => {
    const requiredKeys = Array.from(requiredPlaceholders.value || []);
    if (!showFirstContactTemplate.value || !requiredKeys.length) {
      placeholderGlobalError.value = '';
      placeholderDaysError.value = '';
      return true;
    }
    const missingCounts = new Map(requiredKeys.map(key => [key, 0]));
    form.recipients.forEach(recipient => {
      requiredKeys.forEach(key => {
        if (!recipientHasValue(recipient, key)) missingCounts.set(key, missingCounts.get(key) + 1);
      });
    });
    const missing = Array.from(missingCounts.entries()).filter(([, count]) => count > 0);
    if (!missing.length) {
      placeholderGlobalError.value = '';
      placeholderDaysError.value = '';
      return true;
    }
    const varsMap = knownVariables.value;
    const summary = missing
      .map(([key, count]) => `${varsMap.get(key)?.raw || key} (${count})`)
      .join(', ');
    const message = `Preencha as variáveis requeridas nos destinatários: ${summary}.`;
    placeholderGlobalError.value = text.placeholders.global(message);
    placeholderDaysError.value = form.channel === 'whatsapp' ? text.placeholders.day(message) : '';
    return false;
  };

  const isValid = computed(() => {
    if (!isNameValid.value || !form.channel || !form.recipients.length) return false;
    if (form.channel === 'email') {
      if (!form.recipients.every(recipient => Boolean(recipient.email?.trim()))) return false;
    } else {
      if (!form.recipients.every(recipient => hasPhoneDigits(recipient.phone))) return false;
      if (!form.agent) return false;
    }
    if (!startDateValue.value || !endDateValue.value || !validDateRange.value) return false;
    if (!form.daysOfWeek.length || !isTimeSelectionEnabled.value || !isTimeValid.value) return false;
    if (!form.timezone || !placeholdersSatisfied()) return false;
    if (form.channel === 'whatsapp') {
      if (showFirstContactTemplate.value && !selectedTemplate.value) return false;
      if (!showFirstContactTemplate.value) {
        const allDaysHaveMessage = form.daysOfWeek.every(day =>
          Boolean((form.payload?.messagesByDay?.[day] || '').trim())
        );
        if (!allDaysHaveMessage) return false;
      }
    }
    return true;
  });

  const recomputeRequiredPlaceholders = () => {
    const details = new Map();
    const record = (normalized, raw) => {
      if (!normalized) return;
      const current = details.get(normalized) || { raw: raw || normalized };
      if (!current.raw && raw) current.raw = raw;
      details.set(normalized, current);
    };

    if (form.channel === 'email') {
      ['subject', 'text', 'html'].forEach(key => {
        extractPlaceholders(form.payload?.[key]).forEach((raw, normalized) => record(normalized, raw));
      });
    } else {
      const byDay = form.payload?.messagesByDay || {};
      form.daysOfWeek.forEach(day => {
        extractPlaceholders(byDay[day]).forEach((raw, normalized) => record(normalized, raw));
      });
      extractPlaceholders(form.payload?.message).forEach((raw, normalized) => record(normalized, raw));
    }

    if (showFirstContactTemplate.value) {
      Object.values(selectedTemplate.value?.placeholderEntries || {}).forEach(entries => {
        entries.forEach(({ raw, normalized }) => record(normalized, raw));
      });
      if (!selectedTemplate.value && templateFallback.value?.params) {
        Object.values(templateFallback.value.params).forEach(mapping => {
          Object.keys(mapping || {}).forEach(key => record(normalizeVarKey(key), key));
        });
      }
    }

    requiredPlaceholders.value = new Set(details.keys());
    updateVariableRegistry(details);
    placeholderGlobalError.value = '';
    placeholderDaysError.value = '';
    placeholdersSatisfied();
  };

  const updateVariableRegistry = details => {
    const orderedKeys = Array.from(details.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    const customKeys = orderedKeys.filter(key => !RESERVED_TEMPLATE_VARIABLES.has(key));
    const nextMap = new Map();
    customKeys.forEach(key => {
      const info = details.get(key) || {};
      nextMap.set(key, { key, raw: info.raw || key });
    });
    knownVariables.value = nextMap;
    form.customFields = [...customKeys];
    form.recipients = form.recipients.map(recipient => {
      const vars = { ...(recipient.vars || {}) };
      customKeys.forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(vars, key)) vars[key] = '';
      });
      Object.keys(vars).forEach(existingKey => {
        if (!details.has(existingKey) || RESERVED_TEMPLATE_VARIABLES.has(existingKey)) delete vars[existingKey];
      });
      return { ...recipient, vars };
    });
  };

  // #endregion Template & Recipient Helpers

  // #region Placeholder Watchers

  watch(showFirstContactTemplate, value => {
    if (!value) templateFallback.value = null;
    if (value && selectedTemplate.value && !templateFallback.value) {
      templateFallback.value = buildTemplateFallbackObject(selectedTemplate.value);
    }
    recomputeRequiredPlaceholders();
  });

  // #endregion Placeholder Watchers

  // #region Form Actions

  const resetForm = () => {
    Object.assign(form, {
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
    originalName.value = '';
    selectedTemplateKey.value = '';
    csvReport.value = null;
    Object.assign(status, { show: false, ok: true, msg: '' });
    requiredPlaceholders.value = new Set();
    placeholderGlobalError.value = '';
    placeholderDaysError.value = '';
    templateFallback.value = null;
    knownVariables.value = new Map();
    firstContactAll.value = false;
    dailyWeekdays.value = false;
    initDefaultDates();
    ensureValidTimeSelection();
  };

  const hydrateFromValue = value => {
    if (!value) {
      resetForm();
      templates.value = [];
      selectedTemplateKey.value = '';
      recomputeRequiredPlaceholders();
      return;
    }

    const incomingName = value.Name || value.name || '';
    originalName.value = incomingName;
    Object.assign(form, {
      name: sanitizeScheduleName(incomingName),
      channel: value.Channel || '',
      agent: value.Agent || '',
    });

    const recipientsRaw = Array.isArray(value.Recipients)
      ? JSON.parse(JSON.stringify(value.Recipients))
      : [];
    form.recipients = normalizeRecipientsForChannel(recipientsRaw, form.channel);

    const customKeys = Array.from(
      new Set(
        form.recipients.flatMap(recipient => Object.keys(recipient.vars || {}))
      )
    ).filter(key => !RESERVED_TEMPLATE_VARIABLES.has(key));
    form.customFields = [...customKeys];

    form.recipients = form.recipients.map(recipient => {
      const vars = { ...(recipient.vars || {}) };
      customKeys.forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(vars, key)) vars[key] = '';
      });
      return { ...recipient, vars };
    });

    firstContactAll.value = form.recipients.some(recipient => Boolean(recipient.primeiroContato));

    const defaultPayload =
      form.channel === 'email'
        ? { subject: '', text: '', html: '' }
        : { message: 'Olá {{name}}!', messagesByDay: {} };
    const sourcePayload = value.Payload || defaultPayload;
    const payload = JSON.parse(JSON.stringify(sourcePayload));
    if (form.channel === 'whatsapp' && !payload.messagesByDay) payload.messagesByDay = {};
    form.payload = payload;
    templateFallback.value = sourcePayload?.template_fallback || null;

    Object.assign(form, {
      enabled: Boolean(value.Enabled),
      startAt: value.StartAt || '',
      endAt: value.EndAt || '',
      daysOfWeek: Array.isArray(value.DaysOfWeek) ? [...value.DaysOfWeek] : [],
      time: value.Time || '',
      timezone: value.Timezone || BRT_TIMEZONE,
    });
    dailyWeekdays.value =
      form.daysOfWeek.length === WEEKDAYS.length &&
      WEEKDAYS.every(day => form.daysOfWeek.includes(day));

    selectedTemplateKey.value = '';
    csvReport.value = null;
    Object.assign(status, { show: false, ok: true, msg: '' });

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
  };

  async function loadAgents() {
    agentsLoading.value = true;
    try {
      const { data } = await axios.get(AGENTS_API);
      agents.value = Array.isArray(data?.items)
        ? data.items.map(item => {
            const name = item.name || '';
            const phoneLabel = item.label || item.number || '';
            const display =
              name && phoneLabel ? `${name} (${phoneLabel})` : name || phoneLabel;
            return {
              id: item.id,
              name,
              label: display,
              number: item.number,
              numberReadable: phoneLabel,
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

  const addRecipient = () => {
    const vars = Object.fromEntries(Array.from(knownVariables.value.keys()).map(key => [key, '']));
    const recipient = normalizeRecipientForChannel(
      {
        name: '',
        phone: form.channel === 'whatsapp' ? '+55' : undefined,
        email: form.channel === 'email' ? '' : undefined,
        vars,
        primeiroContato: Boolean(firstContactAll.value),
      },
      form.channel
    );
    form.recipients = [...form.recipients, recipient];
    nextTick(recomputeRequiredPlaceholders);
  };

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

  const removeRecipient = index => {
    form.recipients = form.recipients.filter((_, recipientIndex) => recipientIndex !== index);
    nextTick(recomputeRequiredPlaceholders);
  };

  const detectDelimiter = headerLine =>
    ((headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ';' : ',');

  const parseCsvText = textValue => {
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
  };

  const handleCsvUpload = event => {
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

        form.recipients = normalizeRecipientsForChannel(
          [...form.recipients, ...freshRecipients],
          form.channel
        );
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
  };

  const downloadCsvTemplate = () => {
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
  };

  const deriveEnabledFromPeriod = () => {
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
  };

  const buildPayload = () => {
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
  };

  const submit = async () => {
    if (!isValid.value || submitting.value) return;
    submitting.value = true;
    status.show = false;
    try {
      const payload = buildPayload();
      if (isEdit.value) {
        await api.put(`/${encodeURIComponent(originalName.value)}`, payload);
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
  };

  // #endregion Form Actions

  // #region Form Watchers

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
        form.recipients = normalizeRecipientsForChannel(form.recipients, '');
        form.payload = { message: 'Olá {{name}}!', messagesByDay: {} };
        templates.value = [];
        selectedTemplateKey.value = '';
        templateFallback.value = null;
        return;
      }
      form.recipients = normalizeRecipientsForChannel(form.recipients, channel);

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
    form.daysOfWeek = val ? WEEKDAYS.slice() : [];
  });

  watch(startDateValue, ensureValidTimeSelection);

  watch(availableTimeOptions, ensureValidTimeSelection);

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

  // #endregion Form Watchers

  // #region Lifecycle

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

  // #endregion Lifecycle

  // #region Exposed API

  return {
    text,
    DAYS_OF_WEEK,
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
    startDateInput,
    endDateInput,
    startDateMin,
    endDateMin,
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
    hasHeaderVars,
    hasBodyVars,
    variableLabelMap,
    isValid,
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
  // #endregion Exposed API
}
