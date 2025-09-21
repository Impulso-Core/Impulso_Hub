<script setup>
/* eslint-disable no-unused-vars */
import Button from 'dashboard/components-next/button/Button.vue';
import { useEventsForm } from './events-form.script.js';

const props = defineProps({
  value: { type: Object, default: null },
});
const emit = defineEmits(['saved', 'close']);

const {
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
} = useEventsForm(props, emit);
</script>

<template src="./events-form.template.html"></template>

<style scoped src="./events-form.styles.css"></style>
