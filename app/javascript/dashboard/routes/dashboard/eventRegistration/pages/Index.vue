<script setup>
/* eslint-disable no-unused-vars */
import Button from 'dashboard/components-next/button/Button.vue';
import Dialog from 'dashboard/components-next/dialog/Dialog.vue';
import EventForm from '../components/EventForm.vue';
import { useEventsScreen } from './events-screen.script.js';

const {
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
} = useEventsScreen();
</script>

<template src="./events-screen.template.html"></template>

<style scoped src="./events-screen.styles.css"></style>
