<script setup>
/* eslint-disable no-unused-vars, vue/no-unused-properties */
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
  startDate,
  endDate,
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
