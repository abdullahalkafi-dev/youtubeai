import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { api } from '@/lib/api';
import type {
  AutomationStats,
  AutomationBatch,
  PaginatedBatches,
} from '@/types/automation';

interface AutomationState {
  stats: AutomationStats | null;
  activeBatch: AutomationBatch | null;
  batches: AutomationBatch[];
  totalBatches: number;
  currentPage: number;
  totalPages: number;
  loading: boolean;
  triggering: boolean;
  error: string | null;
}

const initialState: AutomationState = {
  stats: null,
  activeBatch: null,
  batches: [],
  totalBatches: 0,
  currentPage: 1,
  totalPages: 1,
  loading: false,
  triggering: false,
  error: null,
};

export const fetchAutomationStats = createAsyncThunk(
  'automation/fetchStats',
  async (channelId: string) => {
    return api.getAutomationStats(channelId);
  },
);

export const fetchAutomationBatches = createAsyncThunk(
  'automation/fetchBatches',
  async ({
    channelId,
    page = 1,
    limit = 10,
  }: {
    channelId: string;
    page?: number;
    limit?: number;
  }) => {
    return api.getAutomationBatches(channelId, page, limit);
  },
);

export const fetchActiveBatch = createAsyncThunk(
  'automation/fetchActiveBatch',
  async (channelId: string) => {
    return api.getActiveAutomationBatch(channelId);
  },
);

export const runBatchAsync = createAsyncThunk(
  'automation/runBatch',
  async ({
    channelId,
    batchSize = 30,
    source = 'manual_ui_batch',
  }: {
    channelId: string;
    batchSize?: number;
    source?: string;
  }) => {
    return api.runAutomationBatch(channelId, batchSize, source);
  },
);

export const retryBatchAsync = createAsyncThunk(
  'automation/retryBatch',
  async (batchId: string) => {
    return api.retryAutomationBatch(batchId);
  },
);

export const cancelBatchAsync = createAsyncThunk(
  'automation/cancelBatch',
  async (batchId: string) => {
    return api.cancelAutomationBatch(batchId);
  },
);

export const automationSlice = createSlice({
  name: 'automation',
  initialState,
  reducers: {
    onBatchStarted: (state, action: PayloadAction<any>) => {
      if (state.stats) {
        state.stats.isBatchRunning = true;
      }
      // If we don't have full batch yet, set dummy activeBatch
      if (!state.activeBatch || state.activeBatch.id !== action.payload.batchId) {
        state.activeBatch = {
          id: action.payload.batchId,
          _id: action.payload.batchId,
          channelId: action.payload.channelId || '',
          type: 'video_seo',
          source: action.payload.source || 'manual_ui_batch',
          parentBatchId: action.payload.parentBatchId,
          status: 'generating',
          totalItems: action.payload.totalItems || 0,
          successfulItems: 0,
          failedItems: 0,
          skippedItems: 0,
          quotaUnitsUsed: 0,
          startedAt: action.payload.startedAt || new Date().toISOString(),
          items: [],
        };
      }
    },
    onItemProgress: (state, action: PayloadAction<any>) => {
      const { batchId, itemIndex, stage, status, error, generatedTitle, title, reason } = action.payload;
      if (state.activeBatch && (state.activeBatch.id === batchId || state.activeBatch._id === batchId)) {
        if (state.activeBatch.items && state.activeBatch.items[itemIndex]) {
          const item = state.activeBatch.items[itemIndex];
          item.status = status;
          if (stage) (item as any).stage = stage;
          if (generatedTitle) item.generatedTitle = generatedTitle;
          if (title) item.generatedTitle = title;
          if (error) item.error = error;
          if (reason) item.error = reason;
        }

        // Update overall counters
        if (status === 'completed') {
          state.activeBatch.successfulItems = (state.activeBatch.successfulItems || 0) + 1;
        } else if (status === 'failed') {
          state.activeBatch.failedItems = (state.activeBatch.failedItems || 0) + 1;
        } else if (status === 'skipped_manual_override') {
          state.activeBatch.skippedItems = (state.activeBatch.skippedItems || 0) + 1;
        }

        if (stage === 'pushing' && state.activeBatch.status !== 'pushing') {
          state.activeBatch.status = 'pushing';
        }
      }
    },
    onBatchCompleted: (state, action: PayloadAction<any>) => {
      if (state.stats) {
        state.stats.isBatchRunning = false;
      }
      if (state.activeBatch && (state.activeBatch.id === action.payload.batchId || state.activeBatch._id === action.payload.batchId)) {
        state.activeBatch.status = action.payload.status || 'completed';
        state.activeBatch.completedAt = action.payload.completedAt || new Date().toISOString();
        if (action.payload.successful !== undefined) state.activeBatch.successfulItems = action.payload.successful;
        if (action.payload.failed !== undefined) state.activeBatch.failedItems = action.payload.failed;
        if (action.payload.skipped !== undefined) state.activeBatch.skippedItems = action.payload.skipped;
      }
    },
    onStatsUpdated: (state, action: PayloadAction<AutomationStats>) => {
      state.stats = action.payload;
      if (action.payload.activeBatch) {
        state.activeBatch = action.payload.activeBatch;
      } else if (!action.payload.isBatchRunning && state.activeBatch?.status === 'completed') {
        // activeBatch completed
      }
    },
    clearActiveBatch: (state) => {
      state.activeBatch = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAutomationStats.pending, (state) => {
        state.loading = true;
      })
      .addCase(fetchAutomationStats.fulfilled, (state, action) => {
        state.loading = false;
        state.stats = action.payload;
        if (action.payload.activeBatch) {
          state.activeBatch = action.payload.activeBatch;
        }
      })
      .addCase(fetchAutomationStats.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message || 'Failed to fetch automation stats';
      })
      .addCase(fetchAutomationBatches.fulfilled, (state, action: PayloadAction<PaginatedBatches>) => {
        state.batches = action.payload.items;
        state.totalBatches = action.payload.total;
        state.currentPage = action.payload.page;
        state.totalPages = action.payload.totalPages;
      })
      .addCase(fetchActiveBatch.fulfilled, (state, action) => {
        state.activeBatch = action.payload;
      })
      .addCase(runBatchAsync.pending, (state) => {
        state.triggering = true;
      })
      .addCase(runBatchAsync.fulfilled, (state) => {
        state.triggering = false;
        if (state.stats) state.stats.isBatchRunning = true;
      })
      .addCase(runBatchAsync.rejected, (state, action) => {
        state.triggering = false;
        state.error = action.error.message || 'Failed to trigger batch';
      });
  },
});

export const {
  onBatchStarted,
  onItemProgress,
  onBatchCompleted,
  onStatsUpdated,
  clearActiveBatch,
} = automationSlice.actions;

export default automationSlice.reducer;
