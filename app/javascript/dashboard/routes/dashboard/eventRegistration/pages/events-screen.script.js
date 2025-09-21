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

export function useEventsScreen() {
  const API_BASE =
    'https://f4wzfjousg.execute-api.us-east-1.amazonaws.com/schedules';
  const LOCAL_TIMEZONE = 'America/Sao_Paulo';
  const WEEKDAY_LABEL = {
    SUN: 'Dom',
    MON: 'Seg',
    TUE: 'Ter',
    WED: 'Qua',
    THU: 'Qui',
    FRI: 'Sex',
    SAT: 'Sáb',
  };

  const text = Object.freeze({
    fallbackDash: '—',
    header: {
      title: 'Agendamentos',
      description:
        'Gerencie disparos recorrentes por WhatsApp ou Email. Crie, organize e acompanhe o status das suas automações de envio em um só lugar.',
    },
    stats: {
      total: 'Total',
      enabled: 'Ativos',
      disabled: 'Inativos',
    },
    filters: {
      searchPlaceholder: 'Buscar por nome, canal ou expressão',
      channels: {
        all: 'Todos',
        whatsapp: 'WhatsApp',
        email: 'Email',
      },
      statuses: {
        all: 'Todos',
        enabled: 'Ativos',
        disabled: 'Inativos',
      },
    },
    empty: {
      icon: '⏱️',
      title: 'Nenhum agendamento encontrado',
      description:
        'Crie o primeiro agendamento ou ajuste os filtros de busca para visualizar registros existentes.',
      action: 'Criar agendamento',
    },
    buttons: {
      refresh: 'Recarregar',
      create: 'Novo agendamento',
      createCompact: 'Criar agendamento',
      preview: 'Prévia',
      removeRecipient: 'Remover',
      toggleRecipientsShow: 'Ver destinatários',
      toggleRecipientsHide: 'Ocultar destinatários',
      toggleEnable: 'Ativar agendamento',
      toggleDisable: 'Desativar agendamento',
      editSchedule: 'Editar agendamento',
      deleteSchedule: 'Excluir agendamento',
    },
    card: {
      statusEnabled: 'Ativo',
      statusDisabled: 'Inativo',
      channelEmail: 'Email',
      channelWhatsapp: 'WhatsApp',
      labels: {
        model: 'Tipo:',
        when: 'Frequência:',
        timeframe: 'Vigência:',
        recipients: 'Destinatários:',
      },
      types: {
        runAt: 'Pontual',
        recurring: 'Recorrente',
      },
    },
    preview: {
      title: 'Prévia do envio',
      fallbackSubject: 'Mensagem',
      empty: '(sem conteúdo)',
      close: 'Fechar',
    },
    delete: {
      title: 'Remover agendamento',
      description:
        'Esta ação não pode ser desfeita. O agendamento será removido definitivamente.',
      confirm: 'Excluir',
      cancel: 'Cancelar',
      question: name =>
        name ? `Confirma a exclusão de ${name}?` : 'Confirma a exclusão?',
    },
    pagination: {
      previous: 'Anterior',
      next: 'Próxima',
      info: (current, total) => `Página ${current} de ${total}`,
    },
    alerts: {
      loadError: 'Falha ao carregar agendamentos. Tente novamente.',
      toggleError: 'Não foi possível atualizar o status do agendamento.',
      deleteSuccess: 'Agendamento removido com sucesso.',
      deleteError: 'Falha ao remover agendamento. Tente novamente.',
    },
  });

  const api = axios.create({ baseURL: API_BASE });

  const schedules = ref([]);
  const loading = ref(false);
  const page = ref(1);
  const pageSize = 6;
  const filters = reactive({
    search: '',
    channel: 'all',
    status: 'all',
  });

  const expandedIds = ref(new Set());
  const togglingId = ref('');
  const deletingId = ref('');
  const deleteTarget = ref(null);
  const selectedSchedule = ref(null);
  const previewContent = reactive({ title: '', body: '' });

  const formDialogRef = ref(null);
  const previewDialogRef = ref(null);
  const deleteDialogRef = ref(null);

  const formDialogOpen = ref(false);
  const previewDialogOpen = ref(false);
  const deleteDialogOpen = ref(false);

  const channelOptions = [
    { value: 'all', label: text.filters.channels.all, icon: 'i-lucide-layers' },
    {
      value: 'whatsapp',
      label: text.filters.channels.whatsapp,
      icon: 'i-lucide-phone',
    },
    {
      value: 'email',
      label: text.filters.channels.email,
      icon: 'i-lucide-mail',
    },
  ];

  const statusOptions = [
    {
      value: 'all',
      label: text.filters.statuses.all,
      badge: 'bg-n-alpha-3 text-n-slate-11',
    },
    {
      value: 'enabled',
      label: text.filters.statuses.enabled,
      badge: 'bg-n-teal-3 text-n-teal-11',
    },
    {
      value: 'disabled',
      label: text.filters.statuses.disabled,
      badge: 'bg-n-slate-3 text-n-slate-11',
    },
  ];

  function formatDateTime(value) {
    if (!value) return text.fallbackDash;
    try {
      const iso =
        typeof value === 'string' && value.includes(' ')
          ? value.replace(' ', 'T')
          : value;
      const date = new Date(iso);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('pt-BR', {
        timeZone: LOCAL_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (_e) {
      return value;
    }
  }

  function humanRecurring(item) {
    if (item.runAt) {
      return formatDateTime(item.runAt);
    }

    const days = item.daysOfWeek || [];
    const time = item.time || text.fallbackDash;

    if (!days.length) return text.fallbackDash;

    const daysCount = days.length;
    const isWeekdays =
      daysCount === 5 &&
      ['MON', 'TUE', 'WED', 'THU', 'FRI'].every(d => days.includes(d));
    const isWeekend =
      daysCount === 2 && ['SAT', 'SUN'].every(d => days.includes(d));
    const isDaily = daysCount === 7;

    if (isDaily) return `Todos os dias às ${time}`;
    if (isWeekdays) return `Dias úteis às ${time}`;
    if (isWeekend) return `Finais de semana às ${time}`;
    if (daysCount === 1) {
      const dayLabel = WEEKDAY_LABEL[days[0]] || days[0];
      return `Toda ${dayLabel} às ${time}`;
    }

    const daysLabel = days.map(day => WEEKDAY_LABEL[day] || day).join(', ');
    return `${daysLabel} às ${time}`;
  }

  function renderTemplate(template, variables) {
    if (!template) return '';
    const normalized = { ...(variables || {}) };
    if (normalized.name && !normalized.nome) normalized.nome = normalized.name;
    if (normalized.nome && !normalized.name) normalized.name = normalized.nome;
    return template.replace(
      /\{\{\s*([a-zA-Z0-9_\-.]+)\s*\}\}/g,
      (_, key) => normalized[key] ?? ''
    );
  }

  function dayKeyFor(timezone) {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || 'UTC',
        weekday: 'short',
      });
      return formatter.format(new Date()).toUpperCase().slice(0, 3);
    } catch (_e) {
      return 'MON';
    }
  }

  function mapApiResponse(rows) {
    return rows.map(row => ({
      eventId: row.Name,
      channel: row.Channel,
      recipients: row.Recipients || [],
      payload: row.Payload || {},
      enabled: Boolean(row.Enabled),
      scheduleExpression: row.ScheduleExpression || '',
      timezone: row.Timezone || null,
      daysOfWeek: row.DaysOfWeek || [],
      time: row.Time || null,
      runAt: row.RunAt || null,
      startAt: row.StartAt || null,
      endAt: row.EndAt || null,
      agent: row.Agent || null,
    }));
  }

  function prepareEditPayload(schedule) {
    return {
      Name: schedule.eventId,
      Channel: schedule.channel,
      Recipients: JSON.parse(JSON.stringify(schedule.recipients || [])),
      Payload: JSON.parse(JSON.stringify(schedule.payload || {})),
      Enabled: schedule.enabled,
      ScheduleExpression: schedule.scheduleExpression,
      Timezone: schedule.timezone,
      DaysOfWeek: schedule.daysOfWeek,
      Time: schedule.time,
      RunAt: schedule.runAt,
      StartAt: schedule.startAt,
      EndAt: schedule.endAt,
      Agent: schedule.agent || null,
    };
  }

  function isExpanded(id) {
    return expandedIds.value.has(id);
  }

  function toggleRecipients(id) {
    const next = new Set(expandedIds.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expandedIds.value = next;
  }

  async function loadSchedules() {
    loading.value = true;
    try {
      const { data } = await api.get('');
      let items = [];
      if (Array.isArray(data?.items)) {
        items = data.items;
      } else if (Array.isArray(data)) {
        items = data;
      }
      schedules.value = mapApiResponse(items);
    } catch (_e) {
      useAlert(text.alerts.loadError);
      schedules.value = [];
    } finally {
      loading.value = false;
    }
  }

  function openForm(schedule) {
    selectedSchedule.value = schedule ? prepareEditPayload(schedule) : null;
    formDialogOpen.value = true;
    nextTick(() => {
      formDialogRef.value?.open();
    });
  }

  function resetFormDialogState() {
    selectedSchedule.value = null;
    formDialogOpen.value = false;
  }

  function hideFormDialog() {
    if (!formDialogOpen.value) {
      resetFormDialogState();
      return;
    }
    formDialogRef.value?.close();
    resetFormDialogState();
  }

  async function handleSaved() {
    hideFormDialog();
    await loadSchedules();
  }

  function openPreview(schedule, recipient) {
    if (!schedule) return;
    const channel = schedule.channel;
    const variables = {
      name: recipient.name || '',
      email: recipient.email || '',
      phone: recipient.phone || '',
      ...(recipient.vars || {}),
    };

    if (channel === 'email') {
      const subject = renderTemplate(
        schedule.payload?.subject || text.preview.fallbackSubject,
        variables
      );
      const body = renderTemplate(
        schedule.payload?.text || schedule.payload?.html || '',
        variables
      );
      previewContent.title = subject || schedule.eventId;
      previewContent.body = body || text.preview.empty;
    } else {
      const dayKey = dayKeyFor(schedule.timezone);
      const byDay = schedule.payload?.messagesByDay || {};
      const fallback = schedule.payload?.message || '';
      const message = renderTemplate(byDay[dayKey] || fallback, variables);
      previewContent.title = schedule.eventId;
      previewContent.body = message || text.preview.empty;
    }

    previewDialogOpen.value = true;
    nextTick(() => {
      previewDialogRef.value?.open();
    });
  }

  function resetPreviewDialogState() {
    previewContent.title = '';
    previewContent.body = '';
    previewDialogOpen.value = false;
  }

  function hidePreviewDialog() {
    if (!previewDialogOpen.value) {
      resetPreviewDialogState();
      return;
    }
    previewDialogRef.value?.close();
    resetPreviewDialogState();
  }

  function resetDeleteDialogState() {
    deleteTarget.value = null;
    deleteDialogOpen.value = false;
  }

  function openDeleteDialog(schedule) {
    deleteTarget.value = schedule;
    deleteDialogOpen.value = true;
    nextTick(() => {
      deleteDialogRef.value?.open();
    });
  }

  function hideDeleteDialog() {
    if (!deleteDialogOpen.value) {
      resetDeleteDialogState();
      return;
    }
    deleteDialogRef.value?.close();
    resetDeleteDialogState();
  }

  async function toggleEnabled(schedule) {
    if (!schedule?.eventId || togglingId.value) return;
    togglingId.value = schedule.eventId;
    try {
      await api.patch(`/${encodeURIComponent(schedule.eventId)}`, {
        enabled: !schedule.enabled,
      });
      schedule.enabled = !schedule.enabled;
    } catch (_e) {
      useAlert(text.alerts.toggleError);
    } finally {
      togglingId.value = '';
    }
  }

  async function confirmDelete() {
    const target = deleteTarget.value;
    if (!target?.eventId) return;
    deletingId.value = target.eventId;
    try {
      await api.delete(`/${encodeURIComponent(target.eventId)}`);
      schedules.value = schedules.value.filter(
        item => item.eventId !== target.eventId
      );
      useAlert(text.alerts.deleteSuccess);
      hideDeleteDialog();
    } catch (_e) {
      useAlert(text.alerts.deleteError);
    } finally {
      deletingId.value = '';
    }
  }

  function handleKeydown(event) {
    if (event.key !== 'Escape') return;
    if (formDialogOpen.value) hideFormDialog();
    if (previewDialogOpen.value) hidePreviewDialog();
    if (deleteDialogOpen.value) hideDeleteDialog();
  }

  const stats = computed(() => {
    const total = schedules.value.length;
    const enabled = schedules.value.filter(item => item.enabled).length;
    const disabled = total - enabled;
    return [
      {
        label: text.stats.total,
        value: total,
        icon: 'i-lucide-calendar-clock',
      },
      {
        label: text.stats.enabled,
        value: enabled,
        icon: 'i-lucide-play-circle',
      },
      {
        label: text.stats.disabled,
        value: disabled,
        icon: 'i-lucide-pause-circle',
      },
    ];
  });

  const filteredSchedules = computed(() => {
    const query = filters.search.trim().toLowerCase();
    return schedules.value
      .filter(item => {
        if (filters.channel !== 'all') {
          return (item.channel || '').toLowerCase() === filters.channel;
        }
        return true;
      })
      .filter(item => {
        if (filters.status === 'all') return true;
        const wantEnabled = filters.status === 'enabled';
        return Boolean(item.enabled) === wantEnabled;
      })
      .filter(item => {
        if (!query) return true;
        return [item.eventId, item.channel, item.scheduleExpression]
          .map(value => (value || '').toString().toLowerCase())
          .some(value => value.includes(query));
      });
  });

  const totalPages = computed(() =>
    Math.max(1, Math.ceil(filteredSchedules.value.length / pageSize))
  );

  const pagedSchedules = computed(() => {
    const start = (page.value - 1) * pageSize;
    return filteredSchedules.value.slice(start, start + pageSize);
  });

  const goToPreviousPage = () => {
    if (page.value <= 1) return;
    page.value -= 1;
  };

  const goToNextPage = () => {
    if (page.value >= totalPages.value) return;
    page.value += 1;
  };

  watch(
    () => filters.search,
    () => {
      page.value = 1;
    }
  );

  watch(
    () => filters.channel,
    () => {
      page.value = 1;
    }
  );

  watch(
    () => filters.status,
    () => {
      page.value = 1;
    }
  );

  watch(filteredSchedules, newList => {
    const maxPage = Math.max(1, Math.ceil(newList.length / pageSize));
    if (page.value > maxPage) page.value = maxPage;
  });

  onMounted(async () => {
    await loadSchedules();
    window.addEventListener('keydown', handleKeydown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown);
  });

  return {
    // state
    text,
    loading,
    schedules,
    filters,
    channelOptions,
    statusOptions,
    expandedIds,
    togglingId,
    deletingId,
    deleteTarget,
    selectedSchedule,
    previewContent,
    formDialogOpen,
    previewDialogOpen,
    deleteDialogOpen,
    page,
    pageSize,
    // refs for dialogs
    formDialogRef,
    previewDialogRef,
    deleteDialogRef,
    // computed
    stats,
    filteredSchedules,
    totalPages,
    pagedSchedules,
    // helpers
    formatDateTime,
    humanRecurring,
    isExpanded,
    // actions
    toggleRecipients,
    loadSchedules,
    openForm,
    resetFormDialogState,
    hideFormDialog,
    handleSaved,
    openPreview,
    resetPreviewDialogState,
    hidePreviewDialog,
    openDeleteDialog,
    resetDeleteDialogState,
    hideDeleteDialog,
    toggleEnabled,
    confirmDelete,
    goToPreviousPage,
    goToNextPage,
  };
}
