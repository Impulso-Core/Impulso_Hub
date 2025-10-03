import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import axios from 'axios';
import { useAlert } from 'dashboard/composables';

export function useEventsScreen() {
  // #region Constants & Text
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

  // #endregion Constants & Text

  // #region Reactive State & Options

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

  // #endregion Reactive State & Options

  // #region Formatting Helpers

  const formatDateTime = value => {
    if (!value) return text.fallbackDash;
    try {
      const iso = typeof value === 'string' && value.includes(' ')
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
  };

  const includesAll = (source, list) => list.every(day => source.includes(day));

  const humanRecurring = item => {
    if (item.runAt) return formatDateTime(item.runAt);
    const days = item.daysOfWeek || [];
    const time = item.time || text.fallbackDash;
    if (!days.length) return text.fallbackDash;
    const labels = {
      daily: days.length === 7,
      weekdays: days.length === 5 && includesAll(days, ['MON', 'TUE', 'WED', 'THU', 'FRI']),
      weekend: days.length === 2 && includesAll(days, ['SAT', 'SUN']),
    };
    if (labels.daily) return `Todos os dias às ${time}`;
    if (labels.weekdays) return `Dias úteis às ${time}`;
    if (labels.weekend) return `Finais de semana às ${time}`;
    if (days.length === 1) {
      const dayLabel = WEEKDAY_LABEL[days[0]] || days[0];
      return `Toda ${dayLabel} às ${time}`;
    }
    const daysLabel = days.map(day => WEEKDAY_LABEL[day] || day).join(', ');
    return `${daysLabel} às ${time}`;
  };

  const renderTemplate = (template, variables) => {
    if (!template) return '';
    const normalized = { ...(variables || {}) };
    if (normalized.name && !normalized.nome) normalized.nome = normalized.name;
    if (normalized.nome && !normalized.name) normalized.name = normalized.nome;
    return template.replace(/\{\{\s*([a-zA-Z0-9_\-.]+)\s*\}\}/g, (_match, key) => normalized[key] ?? '');
  };

  const dayKeyFor = timezone => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone || 'UTC',
        weekday: 'short',
      });
      return formatter.format(new Date()).toUpperCase().slice(0, 3);
    } catch (_e) {
      return 'MON';
    }
  };

  // #endregion Formatting Helpers

  // #region Data Mapping Helpers

  const mapApiResponse = rows =>
    rows.map(row => ({
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

  const prepareEditPayload = schedule => ({
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
  });

  // #endregion Data Mapping Helpers

  // #region UI Actions

  const isExpanded = id => expandedIds.value.has(id);

  const toggleRecipients = id => {
    const next = new Set(expandedIds.value);
    next[next.has(id) ? 'delete' : 'add'](id);
    expandedIds.value = next;
  };

  const loadSchedules = async () => {
    loading.value = true;
    try {
      const { data } = await api.get('');
      const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
      schedules.value = mapApiResponse(items);
    } catch (_e) {
      useAlert(text.alerts.loadError);
      schedules.value = [];
    } finally {
      loading.value = false;
    }
  };

  const openDialog = (dialogRef, flag) => {
    flag.value = true;
    nextTick(() => dialogRef.value?.open());
  };

  const closeDialog = (dialogRef, flag, reset) => {
    if (!flag.value) return reset();
    dialogRef.value?.close();
    reset();
  };

  const openForm = schedule => {
    selectedSchedule.value = schedule ? prepareEditPayload(schedule) : null;
    openDialog(formDialogRef, formDialogOpen);
  };

  const resetFormDialogState = () => {
    selectedSchedule.value = null;
    formDialogOpen.value = false;
  };

  const hideFormDialog = () => closeDialog(formDialogRef, formDialogOpen, resetFormDialogState);

  const handleSaved = async () => {
    hideFormDialog();
    await loadSchedules();
  };

  const openPreview = (schedule, recipient) => {
    if (!schedule) return;
    const variables = {
      name: recipient.name || '',
      email: recipient.email || '',
      phone: recipient.phone || '',
      ...(recipient.vars || {}),
    };
    if (schedule.channel === 'email') {
      const subject = renderTemplate(schedule.payload?.subject || text.preview.fallbackSubject, variables);
      const body = renderTemplate(schedule.payload?.text || schedule.payload?.html || '', variables);
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
    openDialog(previewDialogRef, previewDialogOpen);
  };

  const resetPreviewDialogState = () => {
    previewContent.title = '';
    previewContent.body = '';
    previewDialogOpen.value = false;
  };

  const hidePreviewDialog = () => closeDialog(previewDialogRef, previewDialogOpen, resetPreviewDialogState);

  const resetDeleteDialogState = () => {
    deleteTarget.value = null;
    deleteDialogOpen.value = false;
  };

  const openDeleteDialog = schedule => {
    deleteTarget.value = schedule;
    openDialog(deleteDialogRef, deleteDialogOpen);
  };

  const hideDeleteDialog = () => closeDialog(deleteDialogRef, deleteDialogOpen, resetDeleteDialogState);

  const toggleEnabled = async schedule => {
    if (!schedule?.eventId || togglingId.value) return;
    togglingId.value = schedule.eventId;
    try {
      await api.patch(`/${encodeURIComponent(schedule.eventId)}`, { enabled: !schedule.enabled });
      schedule.enabled = !schedule.enabled;
    } catch (_e) {
      useAlert(text.alerts.toggleError);
    } finally {
      togglingId.value = '';
    }
  };

  const confirmDelete = async () => {
    const target = deleteTarget.value;
    if (!target?.eventId) return;
    deletingId.value = target.eventId;
    try {
      await api.delete(`/${encodeURIComponent(target.eventId)}`);
      schedules.value = schedules.value.filter(item => item.eventId !== target.eventId);
      useAlert(text.alerts.deleteSuccess);
      hideDeleteDialog();
    } catch (_e) {
      useAlert(text.alerts.deleteError);
    } finally {
      deletingId.value = '';
    }
  };

  const handleKeydown = event => {
    if (event.key !== 'Escape') return;
    hideFormDialog();
    hidePreviewDialog();
    hideDeleteDialog();
  };

  // #endregion UI Actions

  // #region Derived State & Pagination

  const stats = computed(() => {
    const total = schedules.value.length;
    const enabled = schedules.value.filter(item => item.enabled).length;
    return [
      { label: text.stats.total, value: total, icon: 'i-lucide-calendar-clock' },
      { label: text.stats.enabled, value: enabled, icon: 'i-lucide-play-circle' },
      { label: text.stats.disabled, value: total - enabled, icon: 'i-lucide-pause-circle' },
    ];
  });

  const filteredSchedules = computed(() => {
    const query = filters.search.trim().toLowerCase();
    return schedules.value.filter(item => {
      const channelMatch = filters.channel === 'all' || (item.channel || '').toLowerCase() === filters.channel;
      if (!channelMatch) return false;
      if (filters.status !== 'all') {
        const wantEnabled = filters.status === 'enabled';
        if (Boolean(item.enabled) !== wantEnabled) return false;
      }
      if (!query) return true;
      return [item.eventId, item.channel, item.scheduleExpression]
        .map(value => (value || '').toString().toLowerCase())
        .some(value => value.includes(query));
    });
  });

  const totalPages = computed(() => Math.max(1, Math.ceil(filteredSchedules.value.length / pageSize)));

  const pagedSchedules = computed(() => {
    const start = (page.value - 1) * pageSize;
    return filteredSchedules.value.slice(start, start + pageSize);
  });

  const goToPreviousPage = () => {
    if (page.value > 1) page.value -= 1;
  };

  const goToNextPage = () => {
    if (page.value < totalPages.value) page.value += 1;
  };

  // #endregion Derived State & Pagination

  // #region Watchers

  watch(
    () => [filters.search, filters.channel, filters.status],
    () => {
      page.value = 1;
    }
  );

  watch(filteredSchedules, newList => {
    const maxPage = Math.max(1, Math.ceil(newList.length / pageSize));
    if (page.value > maxPage) page.value = maxPage;
  });

  // #endregion Watchers

  // #region Lifecycle

  onMounted(async () => {
    await loadSchedules();
    window.addEventListener('keydown', handleKeydown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown);
  });

  // #endregion Lifecycle

  // #region Exposed API

  return {
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
    formDialogRef,
    previewDialogRef,
    deleteDialogRef,
    stats,
    filteredSchedules,
    totalPages,
    pagedSchedules,
    formatDateTime,
    humanRecurring,
    isExpanded,
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
  // #endregion Exposed API
}
