<template>
  <div class="column" :data-column-id="column.id">
    <div class="column-header">
      <div v-if="!isEditing" class="column-title" @dblclick="startEditing">
        <h3>{{ column.name }}</h3>
        <el-tag size="small" round>{{ cards.length }}</el-tag>
      </div>
      <div v-else class="column-edit">
        <el-input
          ref="editInputRef"
          v-model="editName"
          size="small"
          @keyup.enter="saveRename"
          @blur="saveRename"
        />
      </div>
      <el-dropdown trigger="click" @command="handleCommand">
        <el-button text size="small" :icon="MoreFilled" />
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="rename">Rename</el-dropdown-item>
            <el-dropdown-item command="delete" divided>Delete Column</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="column-cards">
      <draggable
        :model-value="cards"
        item-key="id"
        group="cards"
        ghost-class="card-ghost"
        animation="200"
        @end="onCardDragEnd"
      >
        <template #item="{ element: card }">
          <TaskCard
            :card="card"
            :all-columns="allColumns"
            @edit="$emit('edit-card', card)"
            @delete="$emit('delete-card', card)"
            @move="(targetColId) => $emit('move-card', card.id, targetColId, 0)"
          />
        </template>
      </draggable>
    </div>

    <div class="column-footer">
      <el-button text type="primary" :icon="Plus" @click="$emit('add-card', column.id)">
        Add Card
      </el-button>
    </div>
  </div>
</template>

<script setup>
import { ref, nextTick } from 'vue'
import { MoreFilled, Plus } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import TaskCard from './TaskCard.vue'

const props = defineProps({
  column: { type: Object, required: true },
  cards: { type: Array, default: () => [] },
  allColumns: { type: Array, default: () => [] }
})

const emit = defineEmits(['add-card', 'edit-card', 'delete-card', 'move-card', 'rename-column', 'delete-column'])

const isEditing = ref(false)
const editName = ref('')
const editInputRef = ref(null)

function startEditing() {
  editName.value = props.column.name
  isEditing.value = true
  nextTick(() => {
    editInputRef.value?.focus()
  })
}

function saveRename() {
  if (editName.value.trim() && editName.value.trim() !== props.column.name) {
    emit('rename-column', props.column.id, editName.value.trim())
  }
  isEditing.value = false
}

function handleCommand(command) {
  if (command === 'rename') {
    startEditing()
  } else if (command === 'delete') {
    emit('delete-column', props.column)
  }
}

function onCardDragEnd(evt) {
  // SortableJS fires `end` only on the source list; resolve both columns
  // from the drag event so cross-column drops use the real target column.
  const cardId = evt.item?.__draggable_context?.element?.id
  if (!cardId) return

  const fromColumn = evt.from?.closest('[data-column-id]')
  const toColumn = evt.to?.closest('[data-column-id]')
  const fromColumnId = fromColumn ? Number(fromColumn.dataset.columnId) : props.column.id
  const toColumnId = toColumn ? Number(toColumn.dataset.columnId) : props.column.id

  if (!toColumnId || fromColumnId === null) return

  // Dropped back in place: nothing moved, skip the request.
  if (evt.from === evt.to && evt.newIndex === evt.oldIndex) return

  let newIndex = typeof evt.newIndex === 'number' ? evt.newIndex : evt.oldIndex
  if (typeof newIndex !== 'number') {
    newIndex = (props.cards || []).length
  }

  // Same handler as the card menu and the detail dialog: the store owns the
  // state update, including rollback and retry on failure.
  emit('move-card', cardId, toColumnId, newIndex)
}
</script>

<style scoped>
.column {
  width: 300px;
  min-width: 300px;
  background: #f4f5f7;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 160px);
}

.column-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 12px 8px;
}

.column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  flex: 1;
  min-width: 0;
}

.column-title h3 {
  font-size: 15px;
  color: #303133;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.column-edit {
  flex: 1;
  margin-right: 8px;
}

.column-cards {
  flex: 1;
  overflow-y: auto;
  padding: 4px 8px;
  min-height: 60px;
}

.column-cards::-webkit-scrollbar {
  width: 6px;
}

.column-cards::-webkit-scrollbar-thumb {
  background: #c0c4cc;
  border-radius: 3px;
}

.column-footer {
  padding: 8px;
  border-top: 1px solid #e4e7ed;
}

.card-ghost {
  opacity: 0.5;
  background: #e8f4ff;
  border-radius: 6px;
}
</style>
