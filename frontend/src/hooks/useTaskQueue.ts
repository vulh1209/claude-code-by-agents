import { useState, useEffect, useCallback, useRef } from "react";
import type {
  TaskQueue,
  QueueTask,
  TaskInput,
  TaskQueueSettings,
  TaskQueueEvent,
  CreateQueueRequest,
  CreateQueueResponse,
  GetQueueResponse,
  ListQueuesResponse,
  QueueListItem,
  DEFAULT_QUEUE_SETTINGS,
} from "../../../shared/taskQueueTypes";

// API base URL - will be overridden by agent endpoint
const API_BASE = "";

interface TaskQueueState {
  queues: Record<string, TaskQueue>;
  activeQueueId: string | null;
  queueList: QueueListItem[];
  isLoading: boolean;
  error: string | null;
}

const initialState: TaskQueueState = {
  queues: {},
  activeQueueId: null,
  queueList: [],
  isLoading: false,
  error: null,
};

export function useTaskQueue(apiEndpoint: string = API_BASE) {
  const [state, setState] = useState<TaskQueueState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  const isElectron = typeof window !== "undefined" && !!window.electronAPI?.storage;

  // Load persisted queues and handle interrupted queues on mount
  useEffect(() => {
    loadPersistedQueues();
    checkForInterruptedQueues();
    return () => {
      // Cleanup EventSource on unmount
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  /**
   * Load queues from Electron storage or fetch from API
   */
  const loadPersistedQueues = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      if (isElectron) {
        // Load from Electron storage
        const result = await window.electronAPI!.storage.listTaskQueues();
        if (result.success) {
          setState((prev) => ({
            ...prev,
            queueList: result.data ?? [],
            isLoading: false,
          }));
        }
      } else if (apiEndpoint) {
        // Fetch from API
        const response = await fetch(`${apiEndpoint}/api/queues`);
        if (response.ok) {
          const data: ListQueuesResponse = await response.json();
          setState((prev) => ({
            ...prev,
            queueList: data.queues,
            isLoading: false,
          }));
        }
      }
    } catch (error) {
      console.error("Failed to load queues:", error);
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : "Failed to load queues",
      }));
    }
  }, [apiEndpoint, isElectron]);

  /**
   * Check for interrupted queues on app startup and restore them
   * - Reset "in_progress" tasks to "pending" (they were interrupted mid-execution)
   * - Mark "running" queues as "paused" (user can choose to resume)
   */
  const checkForInterruptedQueues = useCallback(async () => {
    if (!isElectron) return;

    try {
      const result = await window.electronAPI!.storage.loadInterruptedQueues();
      if (!result.success || !result.data || result.data.length === 0) {
        return;
      }

      console.log(`🔄 Found ${result.data.length} interrupted queue(s) to restore`);

      const restoredQueues: Record<string, TaskQueue> = {};

      for (const queue of result.data as TaskQueue[]) {
        // Reset in_progress tasks to pending
        const restoredTasks = queue.tasks.map((task) => {
          if (task.status === "in_progress" || task.status === "retrying") {
            return {
              ...task,
              status: "pending" as const,
              startedAt: undefined,
            };
          }
          return task;
        });

        // Mark running queues as paused
        const restoredQueue: TaskQueue = {
          ...queue,
          status: queue.status === "running" ? "paused" : queue.status,
          tasks: restoredTasks,
          // Recalculate metrics
          metrics: {
            totalTasks: restoredTasks.length,
            completedTasks: restoredTasks.filter((t) => t.status === "completed").length,
            failedTasks: restoredTasks.filter((t) => t.status === "failed").length,
            pendingTasks: restoredTasks.filter(
              (t) => t.status === "pending" || t.status === "queued"
            ).length,
            inProgressTasks: 0, // Reset since we paused all in-progress
          },
        };

        restoredQueues[queue.id] = restoredQueue;

        // Save the restored queue back to storage
        await window.electronAPI!.storage.saveTaskQueue(queue.id, restoredQueue);

        console.log(`✅ Restored queue: ${queue.name} (${queue.id})`);
      }

      // Update state with restored queues
      setState((prev) => ({
        ...prev,
        queues: { ...prev.queues, ...restoredQueues },
      }));
    } catch (error) {
      console.error("Failed to check for interrupted queues:", error);
    }
  }, [isElectron]);

  /**
   * Create a new task queue
   */
  const createQueue = useCallback(
    async (
      name: string,
      tasks: TaskInput[],
      settings?: Partial<TaskQueueSettings>
    ): Promise<TaskQueue | null> => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        const request: CreateQueueRequest = {
          name,
          tasks,
          settings,
        };

        const response = await fetch(`${apiEndpoint}/api/queue`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        });

        if (!response.ok) {
          throw new Error(`Failed to create queue: ${response.statusText}`);
        }

        const data: CreateQueueResponse = await response.json();
        const queue = data.queue;

        // Save to Electron storage if available
        if (isElectron) {
          await window.electronAPI!.storage.saveTaskQueue(queue.id, queue);
        }

        setState((prev) => ({
          ...prev,
          queues: { ...prev.queues, [queue.id]: queue },
          activeQueueId: queue.id,
          queueList: [
            {
              id: queue.id,
              name: queue.name,
              status: queue.status,
              taskCount: queue.tasks.length,
              completedCount: 0,
              createdAt: queue.createdAt,
            },
            ...prev.queueList,
          ],
          isLoading: false,
        }));

        return queue;
      } catch (error) {
        console.error("Failed to create queue:", error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : "Failed to create queue",
        }));
        return null;
      }
    },
    [apiEndpoint, isElectron]
  );

  /**
   * Load a specific queue by ID
   */
  const loadQueue = useCallback(
    async (queueId: string): Promise<TaskQueue | null> => {
      // Check if already loaded
      if (state.queues[queueId]) {
        setState((prev) => ({ ...prev, activeQueueId: queueId }));
        return state.queues[queueId];
      }

      setState((prev) => ({ ...prev, isLoading: true, error: null }));

      try {
        let queue: TaskQueue | null = null;

        if (isElectron) {
          const result = await window.electronAPI!.storage.loadTaskQueue(queueId);
          if (result.success && result.data) {
            queue = result.data;
          }
        }

        if (!queue && apiEndpoint) {
          const response = await fetch(`${apiEndpoint}/api/queue/${queueId}`);
          if (response.ok) {
            const data: GetQueueResponse = await response.json();
            queue = data.queue;
          }
        }

        if (queue) {
          setState((prev) => ({
            ...prev,
            queues: { ...prev.queues, [queueId]: queue! },
            activeQueueId: queueId,
            isLoading: false,
          }));
          return queue;
        }

        throw new Error("Queue not found");
      } catch (error) {
        console.error("Failed to load queue:", error);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: error instanceof Error ? error.message : "Failed to load queue",
        }));
        return null;
      }
    },
    [apiEndpoint, isElectron, state.queues]
  );

  /**
   * Start queue execution with SSE subscription
   */
  const startQueue = useCallback(
    async (queueId: string): Promise<void> => {
      const queue = state.queues[queueId];
      if (!queue) {
        throw new Error("Queue not loaded");
      }

      // Start the queue via API
      const response = await fetch(`${apiEndpoint}/api/queue/${queueId}/start`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to start queue");
      }

      // Update local state
      setState((prev) => ({
        ...prev,
        queues: {
          ...prev.queues,
          [queueId]: {
            ...prev.queues[queueId],
            status: "running",
            startedAt: Date.now(),
          },
        },
      }));

      // Subscribe to SSE for real-time updates
      subscribeToQueueEvents(queueId);
    },
    [apiEndpoint, state.queues]
  );

  /**
   * Subscribe to SSE events for a queue
   */
  const subscribeToQueueEvents = useCallback(
    (queueId: string) => {
      // Close existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(
        `${apiEndpoint}/api/queue/stream/${queueId}`
      );
      eventSourceRef.current = eventSource;

      eventSource.onmessage = (event) => {
        try {
          const queueEvent: TaskQueueEvent = JSON.parse(event.data);
          handleQueueEvent(queueEvent);
        } catch (error) {
          console.error("Failed to parse SSE event:", error);
        }
      };

      eventSource.onerror = (error) => {
        console.error("SSE connection error:", error);
        eventSource.close();
        eventSourceRef.current = null;
      };
    },
    [apiEndpoint]
  );

  /**
   * Handle incoming queue events
   */
  const handleQueueEvent = useCallback((event: TaskQueueEvent) => {
    setState((prev) => {
      const queueId =
        "queueId" in event ? event.queueId : (event as { queue?: TaskQueue }).queue?.id;
      if (!queueId) return prev;

      const queue = prev.queues[queueId];
      if (!queue) return prev;

      switch (event.type) {
        case "queue_started":
          return {
            ...prev,
            queues: {
              ...prev.queues,
              [queueId]: { ...queue, status: "running" as const },
            },
          };

        case "queue_paused":
          return {
            ...prev,
            queues: {
              ...prev.queues,
              [queueId]: { ...queue, status: "paused" as const },
            },
          };

        case "queue_resumed":
          return {
            ...prev,
            queues: {
              ...prev.queues,
              [queueId]: { ...queue, status: "running" as const },
            },
          };

        case "queue_completed":
          return {
            ...prev,
            queues: {
              ...prev.queues,
              [queueId]: {
                ...queue,
                status: "completed" as const,
                completedAt: Date.now(),
                metrics: event.metrics,
              },
            },
          };

        case "queue_failed":
          return {
            ...prev,
            queues: {
              ...prev.queues,
              [queueId]: { ...queue, status: "failed" as const },
            },
            error: event.error,
          };

        case "task_started":
          return updateTaskInQueue(prev, queueId, event.taskId, {
            status: "in_progress",
            startedAt: Date.now(),
          });

        case "task_progress":
          // Update task with progress content
          return updateTaskInQueue(prev, queueId, event.taskId, {
            // Progress content can be stored if needed
          });

        case "task_completed":
          return updateTaskInQueue(prev, queueId, event.taskId, {
            status: "completed",
            result: event.result,
            completedAt: Date.now(),
          });

        case "task_failed":
          return updateTaskInQueue(prev, queueId, event.taskId, {
            status: "failed",
            error: event.error,
          });

        case "task_retrying":
          return updateTaskInQueue(prev, queueId, event.taskId, {
            status: "retrying",
            retryCount: event.attempt,
          });

        default:
          return prev;
      }
    });
  }, []);

  /**
   * Helper to update a task within a queue
   */
  const updateTaskInQueue = (
    state: TaskQueueState,
    queueId: string,
    taskId: string,
    updates: Partial<QueueTask>
  ): TaskQueueState => {
    const queue = state.queues[queueId];
    if (!queue) return state;

    const taskIndex = queue.tasks.findIndex((t) => t.id === taskId);
    if (taskIndex === -1) return state;

    const updatedTasks = [...queue.tasks];
    updatedTasks[taskIndex] = { ...updatedTasks[taskIndex], ...updates };

    // Recalculate metrics
    const metrics = {
      totalTasks: updatedTasks.length,
      completedTasks: updatedTasks.filter((t) => t.status === "completed").length,
      failedTasks: updatedTasks.filter((t) => t.status === "failed").length,
      pendingTasks: updatedTasks.filter(
        (t) => t.status === "pending" || t.status === "queued"
      ).length,
      inProgressTasks: updatedTasks.filter((t) => t.status === "in_progress")
        .length,
    };

    return {
      ...state,
      queues: {
        ...state.queues,
        [queueId]: {
          ...queue,
          tasks: updatedTasks,
          metrics,
        },
      },
    };
  };

  /**
   * Pause queue execution
   */
  const pauseQueue = useCallback(
    async (queueId: string): Promise<void> => {
      const response = await fetch(`${apiEndpoint}/api/queue/${queueId}/pause`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to pause queue");
      }

      setState((prev) => ({
        ...prev,
        queues: {
          ...prev.queues,
          [queueId]: { ...prev.queues[queueId], status: "paused" as const },
        },
      }));
    },
    [apiEndpoint]
  );

  /**
   * Resume queue execution
   */
  const resumeQueue = useCallback(
    async (queueId: string): Promise<void> => {
      const response = await fetch(`${apiEndpoint}/api/queue/${queueId}/resume`, {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Failed to resume queue");
      }

      setState((prev) => ({
        ...prev,
        queues: {
          ...prev.queues,
          [queueId]: { ...prev.queues[queueId], status: "running" as const },
        },
      }));
    },
    [apiEndpoint]
  );

  /**
   * Cancel/delete queue
   */
  const cancelQueue = useCallback(
    async (queueId: string): Promise<void> => {
      // Close SSE connection if active
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const response = await fetch(`${apiEndpoint}/api/queue/${queueId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to cancel queue");
      }

      // Delete from Electron storage
      if (isElectron) {
        await window.electronAPI!.storage.deleteTaskQueue(queueId);
      }

      setState((prev) => {
        const { [queueId]: removed, ...remainingQueues } = prev.queues;
        return {
          ...prev,
          queues: remainingQueues,
          queueList: prev.queueList.filter((q) => q.id !== queueId),
          activeQueueId:
            prev.activeQueueId === queueId ? null : prev.activeQueueId,
        };
      });
    },
    [apiEndpoint, isElectron]
  );

  /**
   * Retry a specific task
   */
  const retryTask = useCallback(
    async (queueId: string, taskId: string): Promise<void> => {
      const response = await fetch(
        `${apiEndpoint}/api/queue/${queueId}/tasks/${taskId}/retry`,
        { method: "POST" }
      );

      if (!response.ok) {
        throw new Error("Failed to retry task");
      }

      // Update local state
      setState((prev) =>
        updateTaskInQueue(prev, queueId, taskId, {
          status: "pending",
          retryCount: 0,
          error: undefined,
          result: undefined,
          startedAt: undefined,
          completedAt: undefined,
        })
      );
    },
    [apiEndpoint]
  );

  /**
   * Skip a failed task
   */
  const skipTask = useCallback((queueId: string, taskId: string): void => {
    setState((prev) =>
      updateTaskInQueue(prev, queueId, taskId, {
        status: "cancelled",
      })
    );
  }, []);

  /**
   * Set active queue
   */
  const setActiveQueue = useCallback((queueId: string | null): void => {
    setState((prev) => ({ ...prev, activeQueueId: queueId }));
  }, []);

  /**
   * Get the active queue
   */
  const activeQueue = state.activeQueueId
    ? state.queues[state.activeQueueId]
    : null;

  /**
   * Save queue to storage (for persistence)
   */
  const saveQueueToStorage = useCallback(
    async (queue: TaskQueue): Promise<void> => {
      if (isElectron) {
        await window.electronAPI!.storage.saveTaskQueue(queue.id, queue);
      }
    },
    [isElectron]
  );

  /**
   * Get busy agent IDs (agents currently running queue tasks)
   */
  const busyAgentIds = useCallback((): Set<string> => {
    const busy = new Set<string>();
    for (const queue of Object.values(state.queues)) {
      if (queue.status === "running") {
        for (const task of queue.tasks) {
          if (task.status === "in_progress") {
            busy.add(task.agentId);
          }
        }
      }
    }
    return busy;
  }, [state.queues]);

  return {
    // State
    queues: state.queues,
    queueList: state.queueList,
    activeQueueId: state.activeQueueId,
    activeQueue,
    isLoading: state.isLoading,
    error: state.error,

    // Actions
    createQueue,
    loadQueue,
    startQueue,
    pauseQueue,
    resumeQueue,
    cancelQueue,
    retryTask,
    skipTask,
    setActiveQueue,
    loadPersistedQueues,
    saveQueueToStorage,
    busyAgentIds,
  };
}
