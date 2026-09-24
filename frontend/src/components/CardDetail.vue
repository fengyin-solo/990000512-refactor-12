<template>
  <el-dialog
    :model-value="visible"
    title="Card Details"
    width="540px"
    :close-on-click-modal="false"
    @update:model-value="$emit('update:visible', $event)"
    @open="initForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-position="top">
      <el-form-item label="Title" prop="title">
        <el-input v-model="form.title" placeholder="Card title" maxlength="100" show-word-limit />
      </el-form-item>

      <el-form-item label="Description" prop="description">
        <el-input v-model="form.description" type="textarea" :rows="4" placeholder="Card description" maxlength="500" show-word-limit />
      </el-form-item>

      <div style="display: flex; gap: 16px;">
        <el-form-item label="Priority" prop="priority" style="flex: 1;">
          <el-select v-model="form.priority" style="width: 100%;">
            <el-option label="Low" value="low" />
            <el-option label="Medium" value="medium" />
            <el-option label="High" value="high" />
          </el-select>
        </el-form-item>

        <el-form-item label="Due Date" prop="due_date" style="flex: 1;">
          <el-date-picker
            v-model="form.due_date"
            type="date"
            placeholder="Select date"
            format="YYYY-MM-DD"
            value-format="YYYY-MM-DD"
            style="width: 100%;"
          />
        </el-form-item>
      </div>

      <el-form-item v-if="allColumns.length > 1" label="Move to Column">
        <el-select v-model="moveTarget" placeholder="Select column (optional)" clearable style="width: 100%;">
          <el-option
            v-for="col in allColumns"
            :key="col.id"
            :label="col.name"
            :value="col.id"
            :disabled="col.id === card?.column_id"
          />
        </el-select>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:visible', false)">Cancel</el-button>
      <el-button type="primary" :loading="saving" @click="handleSave">Save Changes</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useBoardStore } from '../stores/board.js'

const props = defineProps({
  visible: Boolean,
  card: { type: Object, default: null },
  allColumns: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:visible', 'updated', 'move'])

const boardStore = useBoardStore()
const formRef = ref(null)
const saving = ref(false)
const moveTarget = ref(null)

const form = ref({
  title: '',
  description: '',
  priority: 'medium',
  due_date: ''
})

const rules = {
  title: [{ required: true, message: 'Title is required', trigger: 'blur' }]
}

function initForm() {
  if (props.card) {
    form.value = {
      title: props.card.title || '',
      description: props.card.description || '',
      priority: props.card.priority || 'medium',
      due_date: props.card.due_date || ''
    }
    moveTarget.value = null
  }
}

async function handleSave() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return

  saving.value = true
  try {
    const updated = await boardStore.updateCard(props.card.id, {
      title: form.value.title,
      description: form.value.description,
      priority: form.value.priority,
      due_date: form.value.due_date || null
    })
    emit('updated', updated)
    ElMessage.success('Card updated')

    // A column change goes through the same move flow as dragging: the
    // parent owns persistence, column counts, rollback and retry.
    if (moveTarget.value && moveTarget.value !== props.card.column_id) {
      emit('move', props.card.id, moveTarget.value, 0)
    }

    emit('update:visible', false)
  } catch (err) {
    ElMessage.error('Failed to update card')
  } finally {
    saving.value = false
  }
}
</script>
