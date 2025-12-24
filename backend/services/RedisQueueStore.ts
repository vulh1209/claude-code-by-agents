/**
 * Redis Queue Store - Centralized storage for Task Queue system
 *
 * Uses Redis as single source of truth for queue data across all clients/backends.
 * Provides pub/sub for real-time updates.
 */

import { createClient, type RedisClientType } from "redis";

import type {
  TaskQueue,
  QueueTask,
  TaskQueueEvent,
  QueueListItem,
  TaskStatus,
  QueueStatus,
} from "../../shared/taskQueueTypes.ts";

// Redis key prefixes
const KEYS = {
  QUEUE: "queue:",           // queue:{queueId} -> Hash (queue metadata)
  QUEUE_TASKS: "queue:tasks:", // queue:tasks:{queueId} -> List (task IDs)
  TASK: "task:",             // task:{taskId} -> Hash (task data)
  PENDING: "queue:pending:", // queue:pending:{queueId} -> List (pending task IDs)
  BUSY_AGENTS: "busy_agents", // Set of agent IDs currently executing tasks
  QUEUE_LIST: "queues",      // Sorted Set (queue IDs sorted by createdAt)
  EVENTS: "queue:events:",   // queue:events:{queueId} -> Pub/Sub channel
};

export class RedisQueueStore {
  private client: RedisClientType | null = null;
  private subscriber: RedisClientType | null = null;
  private isConnected = false;
  private redisUrl: string;

  constructor(redisUrl?: string) {
    // Redis URL should be passed from CLI args or app config
    // Environment variable fallback handled at CLI level
    this.redisUrl = redisUrl || "";
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    if (this.isConnected) return;

    if (!this.redisUrl) {
      console.warn("⚠️ REDIS_URL not configured, Redis queue store disabled");
      return;
    }

    try {
      // Main client for read/write operations
      this.client = createClient({ url: this.redisUrl });
      this.client.on("error", (err: Error) => console.error("Redis Client Error:", err));
      await this.client.connect();

      // Separate client for pub/sub (required by Redis)
      this.subscriber = this.client.duplicate();
      await this.subscriber.connect();

      this.isConnected = true;
      console.log("✅ Connected to Redis");
    } catch (error) {
      console.error("❌ Failed to connect to Redis:", error);
      this.isConnected = false;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
    this.isConnected = false;
    console.log("🔌 Disconnected from Redis");
  }

  /**
   * Check if Redis is available
   */
  isAvailable(): boolean {
    return this.isConnected && this.client !== null;
  }

  // ============================================
  // Queue Operations
  // ============================================

  /**
   * Save a queue to Redis
   */
  async saveQueue(queue: TaskQueue): Promise<void> {
    if (!this.client) return;

    const queueKey = KEYS.QUEUE + queue.id;
    const tasksKey = KEYS.QUEUE_TASKS + queue.id;
    const pendingKey = KEYS.PENDING + queue.id;

    // Save queue metadata as hash
    const queueData = {
      id: queue.id,
      name: queue.name,
      status: queue.status,
      createdAt: String(queue.createdAt),
      startedAt: queue.startedAt ? String(queue.startedAt) : "",
      completedAt: queue.completedAt ? String(queue.completedAt) : "",
      settings: JSON.stringify(queue.settings),
      metrics: JSON.stringify(queue.metrics),
    };

    await this.client.hSet(queueKey, queueData);

    // Add to queue list (sorted set by createdAt)
    await this.client.zAdd(KEYS.QUEUE_LIST, {
      score: queue.createdAt,
      value: queue.id,
    });

    // Save tasks
    for (const task of queue.tasks) {
      await this.saveTask(task);

      // Add task ID to queue's task list
      await this.client.rPush(tasksKey, task.id);

      // Add pending tasks to pending queue
      if (task.status === "pending" || task.status === "queued") {
        await this.client.rPush(pendingKey, task.id);
      }
    }

    console.log(`💾 Saved queue to Redis: ${queue.name} (${queue.id})`);
  }

  /**
   * Load a queue from Redis
   */
  async loadQueue(queueId: string): Promise<TaskQueue | null> {
    if (!this.client) return null;

    const queueKey = KEYS.QUEUE + queueId;
    const tasksKey = KEYS.QUEUE_TASKS + queueId;

    // Get queue metadata
    const queueData = await this.client.hGetAll(queueKey);
    if (!queueData || !queueData.id) return null;

    // Get task IDs
    const taskIds = await this.client.lRange(tasksKey, 0, -1);

    // Load all tasks
    const tasks: QueueTask[] = [];
    for (const taskId of taskIds) {
      const task = await this.loadTask(taskId);
      if (task) tasks.push(task);
    }

    const queue: TaskQueue = {
      id: queueData.id,
      name: queueData.name,
      status: queueData.status as QueueStatus,
      tasks,
      settings: JSON.parse(queueData.settings || "{}"),
      metrics: JSON.parse(queueData.metrics || "{}"),
      createdAt: parseInt(queueData.createdAt, 10),
      startedAt: queueData.startedAt ? parseInt(queueData.startedAt, 10) : undefined,
      completedAt: queueData.completedAt ? parseInt(queueData.completedAt, 10) : undefined,
    };

    return queue;
  }

  /**
   * Delete a queue from Redis
   */
  async deleteQueue(queueId: string): Promise<void> {
    if (!this.client) return;

    const queueKey = KEYS.QUEUE + queueId;
    const tasksKey = KEYS.QUEUE_TASKS + queueId;
    const pendingKey = KEYS.PENDING + queueId;

    // Get task IDs to delete
    const taskIds = await this.client.lRange(tasksKey, 0, -1);

    // Delete tasks
    for (const taskId of taskIds) {
      await this.client.del(KEYS.TASK + taskId);
    }

    // Delete queue data
    await this.client.del(queueKey);
    await this.client.del(tasksKey);
    await this.client.del(pendingKey);
    await this.client.zRem(KEYS.QUEUE_LIST, queueId);

    console.log(`🗑️ Deleted queue from Redis: ${queueId}`);
  }

  /**
   * List all queues (summary only)
   */
  async listQueues(): Promise<QueueListItem[]> {
    if (!this.client) return [];

    // Get queue IDs sorted by createdAt (descending)
    const queueIds = await this.client.zRange(KEYS.QUEUE_LIST, 0, -1, { REV: true });

    const queues: QueueListItem[] = [];
    for (const queueId of queueIds) {
      const queueData = await this.client.hGetAll(KEYS.QUEUE + queueId);
      if (queueData && queueData.id) {
        const metrics = JSON.parse(queueData.metrics || "{}");
        queues.push({
          id: queueData.id,
          name: queueData.name,
          status: queueData.status as QueueStatus,
          taskCount: metrics.totalTasks || 0,
          completedCount: metrics.completedTasks || 0,
          createdAt: parseInt(queueData.createdAt, 10),
        });
      }
    }

    return queues;
  }

  /**
   * Update queue status
   */
  async updateQueueStatus(queueId: string, status: QueueStatus, timestamp?: number): Promise<void> {
    if (!this.client) return;

    const updates: Record<string, string> = { status };

    if (status === "running" && timestamp) {
      updates.startedAt = String(timestamp);
    } else if (status === "completed" && timestamp) {
      updates.completedAt = String(timestamp);
    }

    await this.client.hSet(KEYS.QUEUE + queueId, updates);
  }

  /**
   * Update queue metrics
   */
  async updateQueueMetrics(queueId: string, metrics: TaskQueue["metrics"]): Promise<void> {
    if (!this.client) return;
    await this.client.hSet(KEYS.QUEUE + queueId, { metrics: JSON.stringify(metrics) });
  }

  // ============================================
  // Task Operations
  // ============================================

  /**
   * Save a task to Redis
   */
  async saveTask(task: QueueTask): Promise<void> {
    if (!this.client) return;

    // Build taskData with all string values (Redis hSet requires strings)
    // Use empty string for undefined/null values
    const taskData: Record<string, string> = {
      id: task.id,
      agentId: task.agentId,
      message: task.message,
      status: task.status,
      priority: String(task.priority),
      retryCount: String(task.retryCount),
      maxRetries: String(task.maxRetries),
      createdAt: String(task.createdAt),
      startedAt: task.startedAt ? String(task.startedAt) : "",
      completedAt: task.completedAt ? String(task.completedAt) : "",
      estimatedComplexity: task.estimatedComplexity || "",
      // Serialize complex objects to JSON
      result: task.result ? JSON.stringify(task.result) : "",
      error: task.error ? JSON.stringify(task.error) : "",
      metadata: task.metadata ? JSON.stringify(task.metadata) : "",
    };

    await this.client.hSet(KEYS.TASK + task.id, taskData);
  }

  /**
   * Load a task from Redis
   */
  async loadTask(taskId: string): Promise<QueueTask | null> {
    if (!this.client) return null;

    const taskData = await this.client.hGetAll(KEYS.TASK + taskId);
    if (!taskData || !taskData.id) return null;

    // Parse complex objects from JSON
    const parseJson = <T>(str: string | undefined): T | undefined => {
      if (!str) return undefined;
      try {
        return JSON.parse(str) as T;
      } catch {
        return undefined;
      }
    };

    return {
      id: taskData.id,
      agentId: taskData.agentId,
      message: taskData.message,
      status: taskData.status as TaskStatus,
      priority: parseInt(taskData.priority, 10),
      estimatedComplexity: taskData.estimatedComplexity as QueueTask["estimatedComplexity"] || undefined,
      retryCount: parseInt(taskData.retryCount, 10),
      maxRetries: parseInt(taskData.maxRetries, 10),
      createdAt: parseInt(taskData.createdAt, 10),
      startedAt: taskData.startedAt ? parseInt(taskData.startedAt, 10) : undefined,
      completedAt: taskData.completedAt ? parseInt(taskData.completedAt, 10) : undefined,
      result: parseJson(taskData.result),
      error: parseJson(taskData.error),
      metadata: parseJson(taskData.metadata),
    };
  }

  /**
   * Update task status and related fields
   */
  async updateTask(
    taskId: string,
    updates: Partial<Pick<QueueTask, "status" | "startedAt" | "completedAt" | "result" | "error" | "retryCount">>
  ): Promise<void> {
    if (!this.client) return;

    const data: Record<string, string> = {};
    if (updates.status) data.status = updates.status;
    if (updates.startedAt !== undefined) data.startedAt = updates.startedAt ? String(updates.startedAt) : "";
    if (updates.completedAt !== undefined) data.completedAt = updates.completedAt ? String(updates.completedAt) : "";
    if (updates.result !== undefined) data.result = updates.result ? JSON.stringify(updates.result) : "";
    if (updates.error !== undefined) data.error = updates.error ? JSON.stringify(updates.error) : "";
    if (updates.retryCount !== undefined) data.retryCount = String(updates.retryCount);

    if (Object.keys(data).length > 0) {
      await this.client.hSet(KEYS.TASK + taskId, data);
    }
  }

  /**
   * Get next pending task from queue (atomic pop)
   */
  async popNextTask(queueId: string): Promise<string | null> {
    if (!this.client) return null;
    return await this.client.lPop(KEYS.PENDING + queueId);
  }

  /**
   * Add task back to pending queue (for retry)
   */
  async requeueTask(queueId: string, taskId: string): Promise<void> {
    if (!this.client) return;
    await this.client.lPush(KEYS.PENDING + queueId, taskId);
  }

  /**
   * Get pending task count for a queue
   */
  async getPendingCount(queueId: string): Promise<number> {
    if (!this.client) return 0;
    return await this.client.lLen(KEYS.PENDING + queueId);
  }

  // ============================================
  // Busy Agents Tracking
  // ============================================

  /**
   * Mark agent as busy
   */
  async markAgentBusy(agentId: string): Promise<void> {
    if (!this.client) return;
    await this.client.sAdd(KEYS.BUSY_AGENTS, agentId);
  }

  /**
   * Mark agent as available
   */
  async markAgentAvailable(agentId: string): Promise<void> {
    if (!this.client) return;
    await this.client.sRem(KEYS.BUSY_AGENTS, agentId);
  }

  /**
   * Get all busy agent IDs
   */
  async getBusyAgents(): Promise<Set<string>> {
    if (!this.client) return new Set();
    const agents = await this.client.sMembers(KEYS.BUSY_AGENTS);
    return new Set(agents);
  }

  /**
   * Check if agent is busy
   */
  async isAgentBusy(agentId: string): Promise<boolean> {
    if (!this.client) return false;
    return await this.client.sIsMember(KEYS.BUSY_AGENTS, agentId);
  }

  // ============================================
  // Pub/Sub for Real-time Events
  // ============================================

  /**
   * Publish a queue event
   */
  async publishEvent(queueId: string, event: TaskQueueEvent): Promise<void> {
    if (!this.client) return;
    const channel = KEYS.EVENTS + queueId;
    await this.client.publish(channel, JSON.stringify(event));
  }

  /**
   * Subscribe to queue events
   */
  async subscribeToQueue(
    queueId: string,
    callback: (event: TaskQueueEvent) => void
  ): Promise<() => Promise<void>> {
    if (!this.subscriber) {
      return async () => {};
    }

    const channel = KEYS.EVENTS + queueId;

    await this.subscriber.subscribe(channel, (message) => {
      try {
        const event = JSON.parse(message) as TaskQueueEvent;
        callback(event);
      } catch (error) {
        console.error("Failed to parse queue event:", error);
      }
    });

    // Return unsubscribe function
    return async () => {
      if (this.subscriber) {
        await this.subscriber.unsubscribe(channel);
      }
    };
  }

  // ============================================
  // Recovery Operations
  // ============================================

  /**
   * Load all interrupted queues (running or paused)
   * Used for recovery after backend restart
   */
  async loadInterruptedQueues(): Promise<TaskQueue[]> {
    if (!this.client) return [];

    const queueIds = await this.client.zRange(KEYS.QUEUE_LIST, 0, -1);
    const interruptedQueues: TaskQueue[] = [];

    for (const queueId of queueIds) {
      const status = await this.client.hGet(KEYS.QUEUE + queueId, "status");
      if (status === "running" || status === "paused") {
        const queue = await this.loadQueue(queueId);
        if (queue) {
          interruptedQueues.push(queue);
        }
      }
    }

    return interruptedQueues;
  }

  /**
   * Reset interrupted queue state
   * - Mark running queues as paused
   * - Reset in_progress tasks to pending
   */
  async resetInterruptedQueue(queueId: string): Promise<void> {
    if (!this.client) return;

    // Update queue status
    await this.updateQueueStatus(queueId, "paused");

    // Get all task IDs
    const taskIds = await this.client.lRange(KEYS.QUEUE_TASKS + queueId, 0, -1);
    const pendingKey = KEYS.PENDING + queueId;

    // Clear pending queue and rebuild
    await this.client.del(pendingKey);

    for (const taskId of taskIds) {
      const task = await this.loadTask(taskId);
      if (task) {
        // Reset in_progress tasks to pending
        if (task.status === "in_progress" || task.status === "retrying") {
          await this.updateTask(taskId, {
            status: "pending",
            startedAt: undefined,
          });
          await this.client.rPush(pendingKey, taskId);
        } else if (task.status === "pending" || task.status === "queued") {
          await this.client.rPush(pendingKey, taskId);
        }
      }
    }

    // Clear busy agents (they may have been interrupted)
    await this.client.del(KEYS.BUSY_AGENTS);

    console.log(`🔄 Reset interrupted queue: ${queueId}`);
  }
}

// Singleton instance
let redisStore: RedisQueueStore | null = null;

export function getRedisQueueStore(redisUrl?: string): RedisQueueStore {
  if (!redisStore) {
    redisStore = new RedisQueueStore(redisUrl);
  }
  return redisStore;
}
