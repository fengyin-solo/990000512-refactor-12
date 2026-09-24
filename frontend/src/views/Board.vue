<template>
  <div class="board-page">
    <div class="board-header">
      <div class="board-title">
        <el-button text :icon="ArrowLeft" @click="$router.push('/')">Back</el-button>
        <h2 v-if="boardStore.currentBoard">{{ boardStore.currentBoard.name }}</h2>
      </div>
      <div class="board-actions">
        <el-button type="primary" :icon="Plus" @click="showAddColumn = true">
          Add Column
        </el-button>
      </div>
    </div>

    <div v-if="boardStore.loading" class="loading-state">
      <el-icon class="is-loading" :size="32"><Loading /></el-icon>
      <p>Loading board...</p>
    </div>

    <div v-else class="columns-container">
      <draggable
        v-model="boardStore.columns"
        item-key="id"
        class="columns-wrapper"
        ghost-class="column-ghost"
        animation="200"
        @end="onColumnDragEnd"
      >
        <template #item="{ element: column }">
          <Column
            :column="column"
            :cards="boardStore.cards[column.id] || []"
            :all-columns="boardStore.columns"
            @add-card="handleAddCard"
            @edit-card="openCardDetail"
            @delete-card="confirmDeleteCard"
            @move-card="handleMoveCard"
            @rename-column="handleRenameColumn"
            @delete-column="confirmDeleteColumn"
          />
        </template>
      </draggable>
    </div>

    <!-- Add Column Dialog -->
    <el-dialog v-model="showAddColumn" title="Add Column" width="400px" :close-on-click-modal="false">
      <el-form @submit.prevent="handleAddColumn">
        <el-form-item label="Column Name">
          <el-input v-model="newColumnName" placeholder="Enter column name" @keyup.enter="handleAddColumn" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddColumn = false">Cancel</el-button>
        <el-button type="primary" :disabled="!newColumnName.trim()" @click="handleAddColumn">Add</el-button>
      </template>
    </el-dialog>

    <!-- Add Card Dialog -->
    <AddCardForm
      v-model:visible="showAddCard"
      :column-id="addingToColumnId"
      @added="onCardAdded"
    />

    <!-- Card Detail Dialog -->
    <CardDetail
      v-model:visible="showCardDetail"
      :card="selectedCard"
      :all-columns="boardStore.columns"
      @updated="onCardUpdated"
      @move="handleMoveCard"
    />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, ArrowLeft, Loading } from '@element-plus/icons-vue'
import draggable from 'vuedraggable'
import { useBoardStore } from '../stores/board.js'
import { columnApi } from '../api/index.js'
import Column from '../components/Column.vue'
import AddCardForm from '../components/AddCardForm.vue'
import CardDetail from '../components/CardDetail.vue'

const route = useRoute()
const router = useRouter()
const boardStore = useBoardStore()

const showAddColumn = ref(false)
const newColumnName = ref('')
const showAddCard = ref(false)
const addingToColumnId = ref(null)
const showCardDetail = ref(false)
const selectedCard = ref(null)

onMounted(async () => {
  const boardId = parseInt(route.params.id)
  boardStore.currentBoard = { id: boardId, name: 'Loading...' }
  try {
    await boardStore.fetchColumns(boardId)
    await boardStore.fetchAllCards(boardId)
    // Get board name from boards list or set from URL
    const boards = boardStore.boards
    const found = boards.find(b => b.id === boardId)
    if (found) {
      boardStore.currentBoard = found
    } else {
      // Fetch boards to get the name
      await boardStore.fetchBoards()
      const b = boardStore.boards.find(b => b.id === boardId)
      if (b) boardStore.currentBoard = b
    }
  } catch (err) {
    ElMessage.error('Failed to load board')
    router.push('/')
  }
})

onUnmounted(() => {
  boardStore.clearBoard()
})

async function handleAddColumn() {
  if (!newColumnName.value.trim()) return
  try {
    await boardStore.addColumn(boardStore.currentBoard.id, newColumnName.value.trim())
    newColumnName.value = ''
    showAddColumn.value = false
    ElMessage.success('Column added')
  } catch (err) {
    ElMessage.error('Failed to add column')
  }
}

function handleAddCard(columnId) {
  addingToColumnId.value = columnId
  showAddCard.value = true
}

function onCardAdded() {
  showAddCard.value = false
}

function openCardDetail(card) {
  selectedCard.value = { ...card }
  showCardDetail.value = true
}

function onCardUpdated(updatedCard) {
  selectedCard.value = { ...updatedCard }
}

async function confirmDeleteCard(card) {
  try {
    await ElMessageBox.confirm(
      `Delete "${card.title}"?`,
      'Delete Card',
      { type: 'warning', confirmButtonText: 'Delete', cancelButtonText: 'Cancel' }
    )
    await boardStore.deleteCard(card.id)
    ElMessage.success('Card deleted')
  } catch (err) {
    // cancelled
  }
}

// Unified post-move flow for every entry point (drag, card menu, detail
// dialog): the store performs the optimistic update and rollback; here we
// only own the success message and failure-retry interaction.
async function handleMoveCard(cardId, targetColumnId, position) {
  const runMove = () => boardStore.moveCard(cardId, targetColumnId, position)

  while (true) {
    try {
      await runMove()
      ElMessage.success('Card moved')
      return
    } catch (err) {
      // store has already rolled back to the pre-move state
    }

    // offer another attempt against the rolled-back state
    try {
      await ElMessageBox.confirm(
        'Moving the card failed. Retry?',
        'Move Failed',
        {
          type: 'error',
          confirmButtonText: 'Retry',
          cancelButtonText: 'Cancel',
          distinguishCancelAndClose: true
        }
      )
    } catch (cancel) {
      ElMessage.info('Move cancelled')
      return
    }
  }
}

async function handleRenameColumn(columnId, newName) {
  try {
    await boardStore.renameColumn(columnId, newName)
    ElMessage.success('Column renamed')
  } catch (err) {
    ElMessage.error('Failed to rename column')
  }
}

async function confirmDeleteColumn(column) {
  const cardCount = (boardStore.cards[column.id] || []).length
  const msg = cardCount > 0
    ? `Delete "${column.name}" and its ${cardCount} card(s)?`
    : `Delete "${column.name}"?`
  try {
    await ElMessageBox.confirm(msg, 'Delete Column', {
      type: 'warning',
      confirmButtonText: 'Delete',
      cancelButtonText: 'Cancel'
    })
    await boardStore.deleteColumn(column.id)
    ElMessage.success('Column deleted')
  } catch (err) {
    // cancelled
  }
}

async function onColumnDragEnd(evt) {
  // Update column positions after drag
  const columns = boardStore.columns
  for (let i = 0; i < columns.length; i++) {
    if (columns[i].position !== i) {
      try {
        await columnApi.update(columns[i].id, { position: i })
        columns[i].position = i
      } catch (err) {
        // Refresh to get correct state
        await boardStore.fetchColumns(boardStore.currentBoard.id)
        break
      }
    }
  }
}
</script>

<style scoped>
.board-page {
  padding: 20px;
  height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
}

.board-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.board-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.board-title h2 {
  font-size: 22px;
  color: #303133;
}

.columns-container {
  flex: 1;
  overflow-x: auto;
  overflow-y: hidden;
}

.columns-wrapper {
  display: flex;
  gap: 16px;
  height: 100%;
  min-height: 400px;
}

.column-ghost {
  opacity: 0.5;
  background: #e8f4ff;
  border-radius: 8px;
}

.loading-state {
  text-align: center;
  padding: 60px;
  color: #909399;
}

.loading-state p {
  margin-top: 12px;
}
</style>
