/**
 * Task Queue API Handler
 * Provides endpoints for creating, managing, and executing task queues
 *
 * Uses Redis as the primary storage when available, with in-memory fallback.
 */

import { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ChatRequest } from "../../shared/types.ts";
import type {
  TaskQueue,
  QueueTask,
  CreateQueueRequest,
  CreateQueueResponse,
  GetQueueResponse,
  StartQueueResponse,
  ListQueuesResponse,
  QueueListItem,
  TaskQueueSettings,
  TaskQueueMetrics,
  TaskQueueEvent,
  DEFAULT_QUEUE_SETTINGS,
} from "../../shared/taskQueueTypes.ts";
import { createTaskScheduler, getTaskScheduler, TaskScheduler } from "../services/TaskScheduler.ts";
import { getRedisQueueStore, type RedisQueueStore } from "../services/RedisQueueStore.ts";

// In-memory queue storage (fallback when Redis is not available)
const queues: Map<string, TaskQueue> = new Map();
const activeSchedulers: Map<string, TaskScheduler> = new Map();

// Get Redis store (will be initialized when first accessed)
let redisStore: RedisQueueStore | null = null;

/**
 * Initialize Redis connection for queue handlers
 */
export async function initQueueRedis(redisUrl?: string): Promise<boolean> {
  redisStore = getRedisQueueStore(redisUrl);
  await redisStore.connect();
  return redisStore.isAvailable();
}

/**
 * Check if Redis is available
 */
function isRedisAvailable(): boolean {
  return redisStore !== null && redisStore.isAvailable();
}

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Create initial metrics for a queue
 */
function createInitialMetrics(taskCount: number): TaskQueueMetrics {
  return {
    totalTasks: taskCount,
    completedTasks: 0,
    failedTasks: 0,
    pendingTasks: taskCount,
    inProgressTasks: 0,
  };
}

/**
 * POST /api/queue - Create a new task queue
 */
export async function handleCreateQueue(c: Context): Promise<Response> {
  try {
    const body = await c.req.json<CreateQueueRequest>();

    if (!body.name || !body.tasks || body.tasks.length === 0) {
      return c.json({ error: "Name and at least one task are required" }, 400);
    }

    const queueId = generateId();
    const now = Date.now();

    // Create tasks from input
    const tasks: QueueTask[] = body.tasks.map((input, index) => ({
      id: generateId(),
      agentId: input.agentId,
      message: input.message,
      status: "pending" as const,
      priority: input.priority ?? index + 1,
      estimatedComplexity: input.estimatedComplexity,
      retryCount: 0,
      maxRetries: body.settings?.retryCount ?? 3,
      createdAt: now,
      metadata: {
        parentQueueId: queueId,
        createdBy: "user" as const,
      },
    }));

    // Merge settings with defaults
    const settings: TaskQueueSettings = {
      maxConcurrency: body.settings?.maxConcurrency ?? 3,
      retryCount: body.settings?.retryCount ?? 3,
      retryDelay: body.settings?.retryDelay ?? 2000,
      timeoutPerTask: body.settings?.timeoutPerTask ?? 300000,
    };

    const queue: TaskQueue = {
      id: queueId,
      name: body.name,
      description: body.description,
      tasks,
      settings,
      status: "idle",
      createdAt: now,
      metrics: createInitialMetrics(tasks.length),
    };

    // Save to Redis if available, otherwise use in-memory storage
    if (isRedisAvailable() && redisStore) {
      await redisStore.saveQueue(queue);
      console.log(`✅ Queue saved to Redis: ${queue.name} (${queueId})`);
    } else {
      queues.set(queueId, queue);
      console.log(`📦 Queue saved to memory: ${queue.name} (${queueId})`);
    }

    const response: CreateQueueResponse = {
      queueId,
      queue,
    };

    return c.json(response, 201);
  } catch (error) {
    console.error("Failed to create queue:", error);
    return c.json(
      { error: error instanceof Error ? error.message : "Failed to create queue" },
      500
    );
  }
}

/**
 * GET /api/queue/:queueId - Get queue status and tasks
 */
export async function handleGetQueue(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");

  // Try Redis first, then fall back to in-memory
  let queue: TaskQueue | null | undefined = null;
  if (isRedisAvailable() && redisStore) {
    queue = await redisStore.loadQueue(queueId);
  }
  if (!queue) {
    queue = queues.get(queueId);
  }

  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  const response: GetQueueResponse = { queue };
  return c.json(response);
}

/**
 * DELETE /api/queue/:queueId - Delete/cancel a queue
 * Query params:
 *   - force=true: Force delete even if running (will stop execution)
 */
export async function handleDeleteQueue(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");
  const forceDelete = c.req.query("force") === "true";

  // Get queue
  let queue: TaskQueue | null | undefined = null;
  if (isRedisAvailable() && redisStore) {
    queue = await redisStore.loadQueue(queueId);
  } else {
    queue = queues.get(queueId);
  }

  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  // Check if queue is running - only allow delete if not running or force=true
  if (queue.status === "running" && !forceDelete) {
    return c.json({
      error: "Cannot delete running queue. Use force=true to stop and delete, or pause/stop the queue first.",
      status: queue.status
    }, 400);
  }

  // Stop scheduler if running (when force=true)
  const scheduler = activeSchedulers.get(queueId);
  if (scheduler) {
    scheduler.stop();
    activeSchedulers.delete(queueId);
  }

  // Delete from Redis or memory
  if (isRedisAvailable() && redisStore) {
    await redisStore.deleteQueue(queueId);
  } else {
    queues.delete(queueId);
  }

  return c.json({ success: true, message: "Queue deleted" });
}

/**
 * GET /api/queues - List all queues
 */
export async function handleListQueues(c: Context): Promise<Response> {
  let queueList: QueueListItem[];

  // Get from Redis if available, otherwise from memory
  if (isRedisAvailable() && redisStore) {
    queueList = await redisStore.listQueues();
  } else {
    queueList = Array.from(queues.values()).map((q) => ({
      id: q.id,
      name: q.name,
      status: q.status,
      taskCount: q.tasks.length,
      completedCount: q.metrics.completedTasks,
      createdAt: q.createdAt,
    }));
    // Sort by creation time, newest first
    queueList.sort((a, b) => b.createdAt - a.createdAt);
  }

  const response: ListQueuesResponse = { queues: queueList };
  return c.json(response);
}

/**
 * POST /api/queue/:queueId/start - Start queue execution
 */
export async function handleStartQueue(
  c: Context,
  getAgent: (agentId: string) => { id: string; apiEndpoint: string; workingDirectory: string } | undefined,
  claudeAuth?: ChatRequest["claudeAuth"]
): Promise<Response> {
  const queueId = c.req.param("queueId");

  // Get queue from Redis or memory
  let queue: TaskQueue | null | undefined = null;
  if (isRedisAvailable() && redisStore) {
    queue = await redisStore.loadQueue(queueId);
  }
  if (!queue) {
    queue = queues.get(queueId);
  }

  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  if (queue.status === "running") {
    return c.json({ error: "Queue is already running" }, 400);
  }

  queue.status = "running";
  queue.startedAt = Date.now();

  // Update in Redis
  if (isRedisAvailable() && redisStore) {
    await redisStore.updateQueueStatus(queueId, "running", queue.startedAt);
  }

  const response: StartQueueResponse = {
    queueId,
    status: "running",
    streamUrl: `/api/queue/stream/${queueId}`,
  };

  return c.json(response);
}

/**
 * POST /api/queue/:queueId/pause - Pause queue execution
 */
export async function handlePauseQueue(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");

  // Get queue from Redis or memory
  let queue: TaskQueue | null | undefined = null;
  if (isRedisAvailable() && redisStore) {
    queue = await redisStore.loadQueue(queueId);
  }
  if (!queue) {
    queue = queues.get(queueId);
  }

  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  const scheduler = activeSchedulers.get(queueId);
  if (scheduler) {
    scheduler.pause();
  }

  queue.status = "paused";

  // Update in Redis
  if (isRedisAvailable() && redisStore) {
    await redisStore.updateQueueStatus(queueId, "paused");
  }

  return c.json({ success: true, status: "paused" });
}

/**
 * POST /api/queue/:queueId/resume - Resume queue execution
 */
export async function handleResumeQueue(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");

  // Get queue from Redis or memory
  let queue: TaskQueue | null | undefined = null;
  if (isRedisAvailable() && redisStore) {
    queue = await redisStore.loadQueue(queueId);
  }
  if (!queue) {
    queue = queues.get(queueId);
  }

  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  const scheduler = activeSchedulers.get(queueId);
  if (scheduler) {
    scheduler.resume();
  }

  queue.status = "running";

  // Update in Redis
  if (isRedisAvailable() && redisStore) {
    await redisStore.updateQueueStatus(queueId, "running");
  }

  return c.json({ success: true, status: "running" });
}

/**
 * POST /api/queue/:queueId/tasks/:taskId/retry - Retry a specific task
 */
export async function handleRetryTask(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");
  const taskId = c.req.param("taskId");

  // Get queue from Redis or memory
  let queue: TaskQueue | null | undefined = null;
  if (isRedisAvailable() && redisStore) {
    queue = await redisStore.loadQueue(queueId);
  }
  if (!queue) {
    queue = queues.get(queueId);
  }

  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  const task = queue.tasks.find((t) => t.id === taskId);
  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  // Reset task for retry
  task.status = "pending";
  task.retryCount = 0;
  task.error = undefined;
  task.result = undefined;
  task.startedAt = undefined;
  task.completedAt = undefined;

  // Update in Redis
  if (isRedisAvailable() && redisStore) {
    await redisStore.updateTask(taskId, {
      status: "pending",
      retryCount: 0,
      error: undefined,
      result: undefined,
      startedAt: undefined,
      completedAt: undefined,
    });
    // Add back to pending queue
    await redisStore.requeueTask(queueId, taskId);
  }

  return c.json({ success: true, task });
}

/**
 * GET /api/queue/stream/:queueId - SSE stream for real-time updates
 */
export async function handleQueueStream(
  c: Context,
  getAgent: (agentId: string) => { id: string; apiEndpoint: string; workingDirectory: string } | undefined,
  claudeAuth?: ChatRequest["claudeAuth"],
  redisUrl?: string
): Promise<Response> {
  const queueId = c.req.param("queueId");

  // Get queue from Redis or memory
  let queue: TaskQueue | null | undefined = null;
  if (isRedisAvailable() && redisStore) {
    queue = await redisStore.loadQueue(queueId);
  }
  if (!queue) {
    queue = queues.get(queueId);
  }

  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  // Create a new scheduler for this queue with Redis support
  const scheduler = createTaskScheduler({ debugMode: false, redisUrl });
  if (redisUrl) {
    await scheduler.initRedis();
  }
  activeSchedulers.set(queueId, scheduler);

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of scheduler.executeQueue(queue!, getAgent, claudeAuth)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });

        // Update queue in memory (Redis is updated by scheduler)
        if (!isRedisAvailable()) {
          queues.set(queueId, queue!);
        }
      }
    } catch (error) {
      console.error("Queue stream error:", error);
      await stream.writeSSE({
        data: JSON.stringify({
          type: "queue_failed",
          queueId,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        event: "queue_failed",
      });
    } finally {
      activeSchedulers.delete(queueId);
    }
  });
}

/**
 * Get queue by ID (for internal use)
 */
export async function getQueueById(queueId: string): Promise<TaskQueue | undefined> {
  if (isRedisAvailable() && redisStore) {
    const queue = await redisStore.loadQueue(queueId);
    return queue || undefined;
  }
  return queues.get(queueId);
}

/**
 * Update queue in storage (for internal use)
 */
export async function updateQueue(queue: TaskQueue): Promise<void> {
  if (isRedisAvailable() && redisStore) {
    await redisStore.saveQueue(queue);
  } else {
    queues.set(queue.id, queue);
  }
}

/**
 * GET /api/queue/busy-agents - Get list of busy agent IDs
 */
export async function handleGetBusyAgents(c: Context): Promise<Response> {
  let busyAgents: string[] = [];

  if (isRedisAvailable() && redisStore) {
    const busySet = await redisStore.getBusyAgents();
    busyAgents = Array.from(busySet);
  } else {
    // Fallback: scan active schedulers (less accurate)
    // In-memory mode doesn't track busy agents globally
  }

  return c.json({ busyAgents });
}
