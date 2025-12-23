/**
 * Task Queue API Handler
 * Provides endpoints for creating, managing, and executing task queues
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
import { createTaskScheduler, TaskScheduler } from "../services/TaskScheduler.ts";

// In-memory queue storage (for non-Electron environments)
// In production with Electron, this would be replaced by Electron storage
const queues: Map<string, TaskQueue> = new Map();
const activeSchedulers: Map<string, TaskScheduler> = new Map();

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

    queues.set(queueId, queue);

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

  const queue = queues.get(queueId);
  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  const response: GetQueueResponse = { queue };
  return c.json(response);
}

/**
 * DELETE /api/queue/:queueId - Delete/cancel a queue
 */
export async function handleDeleteQueue(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");

  const queue = queues.get(queueId);
  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  // Stop scheduler if running
  const scheduler = activeSchedulers.get(queueId);
  if (scheduler) {
    scheduler.stop();
    activeSchedulers.delete(queueId);
  }

  queues.delete(queueId);

  return c.json({ success: true, message: "Queue deleted" });
}

/**
 * GET /api/queues - List all queues
 */
export async function handleListQueues(c: Context): Promise<Response> {
  const queueList: QueueListItem[] = Array.from(queues.values()).map((q) => ({
    id: q.id,
    name: q.name,
    status: q.status,
    taskCount: q.tasks.length,
    completedCount: q.metrics.completedTasks,
    createdAt: q.createdAt,
  }));

  // Sort by creation time, newest first
  queueList.sort((a, b) => b.createdAt - a.createdAt);

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

  const queue = queues.get(queueId);
  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  if (queue.status === "running") {
    return c.json({ error: "Queue is already running" }, 400);
  }

  queue.status = "running";
  queue.startedAt = Date.now();

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

  const queue = queues.get(queueId);
  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  const scheduler = activeSchedulers.get(queueId);
  if (scheduler) {
    scheduler.pause();
  }

  queue.status = "paused";

  return c.json({ success: true, status: "paused" });
}

/**
 * POST /api/queue/:queueId/resume - Resume queue execution
 */
export async function handleResumeQueue(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");

  const queue = queues.get(queueId);
  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  const scheduler = activeSchedulers.get(queueId);
  if (scheduler) {
    scheduler.resume();
  }

  queue.status = "running";

  return c.json({ success: true, status: "running" });
}

/**
 * POST /api/queue/:queueId/tasks/:taskId/retry - Retry a specific task
 */
export async function handleRetryTask(c: Context): Promise<Response> {
  const queueId = c.req.param("queueId");
  const taskId = c.req.param("taskId");

  const queue = queues.get(queueId);
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

  return c.json({ success: true, task });
}

/**
 * GET /api/queue/stream/:queueId - SSE stream for real-time updates
 */
export async function handleQueueStream(
  c: Context,
  getAgent: (agentId: string) => { id: string; apiEndpoint: string; workingDirectory: string } | undefined,
  claudeAuth?: ChatRequest["claudeAuth"]
): Promise<Response> {
  const queueId = c.req.param("queueId");

  const queue = queues.get(queueId);
  if (!queue) {
    return c.json({ error: "Queue not found" }, 404);
  }

  // Create a new scheduler for this queue
  const scheduler = createTaskScheduler({ debugMode: false });
  activeSchedulers.set(queueId, scheduler);

  return streamSSE(c, async (stream) => {
    try {
      for await (const event of scheduler.executeQueue(queue, getAgent, claudeAuth)) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: event.type,
        });

        // Update queue in storage after each event
        queues.set(queueId, queue);
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
export function getQueueById(queueId: string): TaskQueue | undefined {
  return queues.get(queueId);
}

/**
 * Update queue in storage (for internal use)
 */
export function updateQueue(queue: TaskQueue): void {
  queues.set(queue.id, queue);
}
