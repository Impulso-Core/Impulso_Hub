/* eslint-disable */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
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

  const text = Object.freeze({
    name: {
      label: 'Nome do agendamento',
      placeholder: 'Insira o nome do agendamento aqui',
    },
    channel: {
      label: 'Canal',
      placeholder: 'Selecionar canal',
      options: {
        whatsapp: 'WhatsApp',
        email: 'Email (SES)',
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
      add: 'Adicionar',
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
      message: 'Mensagem padrão',
      templateLabel: 'Templates',
      templateSelect: {
        loading: 'Carregando templates...',
        placeholder: 'Selecionar template...',
        empty: 'Nenhum template encontrado',
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
      title: 'Agendamento',
      description:
        'Configure uma execução única ou defina os dias/horários recorrentes.',
      runOnce: 'Agendar apenas uma vez (runAt)',
      runAt: 'Executar em (ISO UTC)',
      runAtPlaceholder: '2025-09-05T15:00:00Z',
      timezone: 'Timezone',
      timezoneStatic: '— não aplicável —',
      days: 'Dias da semana',
      time: 'Horário (HH:mm)',
      timePlaceholder: '08:00',
      timezonePlaceholder: 'America/Sao_Paulo',
      dayMessagesTitle: 'Mensagens por dia selecionado',
      messageLabel: day => `Mensagem para ${day}`,
      missingMessage: day => `Obrigatório para ${day}.`,
    },
    timeframe: {
      start: 'Dt. de Início:',
      startPlaceholder: '2025-09-01T00:00:00Z',
      end: 'Dt. de Fim:',
      endPlaceholder: '2025-12-31T23:59:59Z',
      error: 'A data de fim deve ser posterior à data de início.',
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
    daysOfWeek: ['MON'],
    time: '08:00',
    timezone: 'America/Sao_Paulo',
    runAt: '',
    startAt: '',
    endAt: '',
  });

  const oneShot = ref(false);
  const submitting = ref(false);
  const status = reactive({ show: false, ok: true, msg: '' });
  const csvReport = ref(null);
  const requiredPlaceholders = ref(new Set());
  const knownVariables = ref(new Map());
  const placeholderGlobalError = ref('');
  const placeholderDaysError = ref('');
  const templateFallback = ref(null);

  const isEdit = computed(() => Boolean(props.value?.Name));
  const isNameFilled = computed(() => !!form.name.trim());
  const canSelectChannel = computed(() => isNameFilled.value);
  const canSelectAgent = computed(() => canSelectChannel.value && !!form.channel);

  const validDateRange = computed(() => {
    const start = form.startAt?.trim();
    const end = form.endAt?.trim();
    if (!start || !end) return true;
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()))
      return true;
    return endDate > startDate;
  });

  const startDate = computed({
    get: () => (form.startAt ? form.startAt.substring(0, 10) : ''),
    set: v => {
      form.startAt = v ? `${v}T00:00:00Z` : '';
    },
  });

  const endDate = computed({
    get: () => (form.endAt ? form.endAt.substring(0, 10) : ''),
    set: v => {
      form.endAt = v ? `${v}T23:59:59Z` : '';
    },
  });

  function initDefaultDates() {
    const today = new Date().toISOString().slice(0, 10);
    if (!form.startAt) form.startAt = `${today}T00:00:00Z`;
    if (!form.endAt) form.endAt = `${today}T23:59:59Z`;
  }

  const selectedTemplate = computed(
    () =>
      templates.value.find(
        template => template.key === selectedTemplateKey.value
      ) || null
  );

  const showFirstContactTemplate = computed(() =>
    form.recipients.some(recipient => Boolean(recipient.primeiroContato))
  );

  const variableEntries = computed(() => {
    const entries = [];
    knownVariables.value.forEach((info, key) => {
      entries.push({ key, label: info.raw || key });
    });
    return entries;
  });

  const variableLabelMap = computed(() => {
    const map = {};
    knownVariables.value.forEach((info, key) => {
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
    const digits = (phone || '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
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
      return Boolean(recipient.phone && recipient.phone.trim());
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
      !oneShot.value && form.channel === 'whatsapp'
        ? text.placeholders.day(message)
        : '';

    return false;
  }

  const isValid = computed(() => {
    if (!form.name || !form.name.trim()) return false;
    if (!form.channel) return false;
    if (!form.recipients.length) return false;

    if (form.channel === 'email') {
      const everyHasEmail = form.recipients.every(recipient =>
        Boolean(recipient.email)
      );
      if (!everyHasEmail) return false;
    } else {
      const everyHasPhone = form.recipients.every(recipient =>
        Boolean(recipient.phone)
      );
      if (!everyHasPhone) return false;
      if (!form.agent) return false;
    }

    if (!validDateRange.value) return false;
    if (!placeholdersSatisfied()) return false;

    if (oneShot.value) {
      return Boolean(form.runAt);
    }

    const dayConfigurationValid =
      form.daysOfWeek.length > 0 && Boolean(form.time) && Boolean(form.timezone);
    if (!dayConfigurationValid) return false;

    if (form.channel === 'whatsapp' && showFirstContactTemplate.value) {
      const allDaysHaveMessage = form.daysOfWeek.every(day => {
        const content = form.payload?.messagesByDay?.[day] || '';
        return Boolean(content.trim());
      });
      if (!allDaysHaveMessage) return false;
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
      const messagePlaceholders = extractPlaceholders(form.payload?.message);
      messagePlaceholders.forEach((raw, normalized) =>
        addPlaceholder(normalized, raw)
      );
      if (!oneShot.value) {
        const byDay = form.payload?.messagesByDay || {};
        form.daysOfWeek.forEach(day => {
          const placeholders = extractPlaceholders(byDay[day]);
          placeholders.forEach((raw, normalized) =>
            addPlaceholder(normalized, raw)
          );
        });
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
      const info = details.get(key) || {};
      nextMap.set(key, {
        key,
        raw: info.raw || key,
      });
    });

    knownVariables.value = nextMap;
    form.customFields = orderedKeys;

    form.recipients = form.recipients.map(recipient => {
      const vars = { ...(recipient.vars || {}) };
      orderedKeys.forEach(key => {
        if (!Object.prototype.hasOwnProperty.call(vars, key)) {
          vars[key] = '';
        }
      });
      Object.keys(vars).forEach(existingKey => {
        if (!details.has(existingKey)) {
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
    form.channel = '';
    form.agent = '';
    form.recipients = [];
    form.payload = { message: 'Olá {{name}}!', messagesByDay: {} };
    form.customFields = [];
    form.enabled = true;
    form.daysOfWeek = ['MON'];
    form.time = '08:00';
    form.timezone = 'America/Sao_Paulo';
    form.runAt = '';
    form.startAt = '';
    form.endAt = '';
    oneShot.value = false;
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
  }

  function hydrateFromValue(value) {
    if (!value) {
      resetForm();
      recomputeRequiredPlaceholders();
      if (form.channel === 'whatsapp' && form.agent) {
        loadTemplates();
      } else {
        templates.value = [];
        selectedTemplateKey.value = '';
      }
      return;
    }

    form.name = value.Name || '';
    form.channel = value.Channel || '';
    form.agent = value.Agent || '';
    form.recipients = Array.isArray(value.Recipients)
      ? JSON.parse(JSON.stringify(value.Recipients))
      : [];

    form.recipients = form.recipients.map(recipient => ({
      name: recipient.name || '',
      email: recipient.email,
      phone: recipient.phone,
      vars: Object.fromEntries(
        Object.entries(recipient.vars || {}).map(([key, v]) => [
          normalizeVarKey(key),
          v,
        ])
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
    form.customFields = Array.from(collected);

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

    if (value.RunAt) {
      oneShot.value = true;
      form.runAt = value.RunAt;
      form.daysOfWeek = [];
      form.time = '';
      form.timezone = '';
    } else {
      oneShot.value = false;
      form.runAt = '';
      form.daysOfWeek = value.DaysOfWeek || ['MON'];
      form.time = value.Time || '08:00';
      form.timezone = value.Timezone || 'America/Sao_Paulo';
    }

    selectedTemplateKey.value = '';
    csvReport.value = null;
    status.show = false;
    status.msg = '';
    status.ok = true;

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
        phone: form.channel === 'whatsapp' ? '' : undefined,
        email: form.channel === 'email' ? '' : undefined,
        vars,
        primeiroContato: false,
      },
    ];
    nextTick(recomputeRequiredPlaceholders);
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
            .map(recipient =>
              needsEmail ? recipient.email?.toLowerCase() : recipient.phone
            )
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
              primeiroContato: false,
            });
            imported += 1;
          } else {
            if (!phone || !isLikelyPhone(phone)) {
              skipped += 1;
              return;
            }
            const normalizedPhone = phone.replace(/\s+/g, '');
            if (existingKeys.has(normalizedPhone)) {
              skipped += 1;
              return;
            }
            existingKeys.add(normalizedPhone);
            freshRecipients.push({
              name,
              phone: normalizedPhone,
              vars,
              primeiroContato: false,
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
    const headers = needsEmail ? ['name', 'email'] : ['name', 'phone'];
    const rows = needsEmail
      ? [
          ['Ana', 'ana@exemplo.com'],
          ['Bruno', 'bruno@exemplo.com'],
        ]
      : [
          ['Ana', '+5532987654321'],
          ['Bruno', '+5531999999999'],
        ];
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

  function buildPayload() {
    const recipientsPayload = form.recipients.map(recipient => ({
      name: recipient.name || '',
      email: recipient.email,
      phone: recipient.phone,
      vars: recipient.vars || {},
      primeiroContato: Boolean(recipient.primeiroContato),
    }));

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
        message: form.payload?.message || 'Olá {{name}}!',
        messagesByDay:
          !oneShot.value && form.channel === 'whatsapp'
            ? form.daysOfWeek.reduce((acc, day) => {
                const value = (form.payload?.messagesByDay?.[day] || '').trim();
                if (value) acc[day] = value;
                return acc;
              }, {})
            : undefined,
      };

      if (templateFallbackPayload) {
        channelPayload.template_fallback = templateFallbackPayload;
      }
    }

    const base = {
      name: form.name,
      channel: form.channel,
      agent: form.channel === 'whatsapp' ? form.agent || undefined : undefined,
      recipients: recipientsPayload,
      payload: channelPayload,
      enabled: Boolean(form.enabled),
      startAt: form.startAt?.trim() || undefined,
      endAt: form.endAt?.trim() || undefined,
    };

    if (oneShot.value) {
      return {
        ...base,
        runAt: form.runAt,
      };
    }

    return {
      ...base,
      daysOfWeek: form.daysOfWeek,
      time: form.time,
      timezone: form.timezone || 'America/Sao_Paulo',
    };
  }

  async function submit() {
    if (!isValid.value || submitting.value) return;
    submitting.value = true;
    status.show = false;
    try {
      const payload = buildPayload();
      if (isEdit.value) {
        await api.put(`/${encodeURIComponent(form.name)}`, payload);
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
        phone: channel === 'whatsapp' ? recipient.phone || '' : undefined,
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
      if (form.channel !== 'whatsapp' || oneShot.value) return;
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

  watch(
    () => oneShot.value,
    () => {
      if (oneShot.value) {
        form.daysOfWeek = [];
        form.time = '';
        // Keep timezone set to default; do not clear it
      } else {
        form.runAt = '';
        if (!form.daysOfWeek.length) form.daysOfWeek = ['MON'];
        if (!form.time) form.time = '08:00';
        if (!form.timezone) form.timezone = 'America/Sao_Paulo';
      }
      nextTick(recomputeRequiredPlaceholders);
    }
  );

  onMounted(() => {
    loadAgents();
    if (form.channel === 'whatsapp' && form.agent) loadTemplates();
    initDefaultDates();
    recomputeRequiredPlaceholders();
  });

  return {
    // constants/text
    text,
    DAYS_OF_WEEK,
    TIME_OPTIONS,

    // state
    agents,
    agentsLoading,
    templates,
    templatesLoading,
    selectedTemplateKey,
    form,
    oneShot,
    submitting,
    status,
    csvReport,
    requiredPlaceholders,
    knownVariables,
    placeholderGlobalError,
    placeholderDaysError,
    templateFallback,

    // computed
    startDate,
    endDate,
    isEdit,
    isNameFilled,
    canSelectChannel,
    canSelectAgent,
    validDateRange,
    selectedTemplate,
    showFirstContactTemplate,
    variableEntries,
    variableLabelMap,

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
    removeRecipient,
    detectDelimiter,
    parseCsvText,
    handleCsvUpload,
    downloadCsvTemplate,
    buildPayload,
    submit,
  };
}
