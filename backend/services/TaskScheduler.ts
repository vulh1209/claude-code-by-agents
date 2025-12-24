/**
 * TaskScheduler Service
 * Manages parallel task execution across multiple agents with retry logic
 *
 * Now integrates with Redis for centralized queue storage and real-time sync
 */

import type { ChatRequest, StreamResponse } from "../../shared/types.ts";
import type {
  TaskQueue,
  QueueTask,
  TaskResult,
  TaskError,
  TaskQueueEvent,
  TaskQueueMetrics,
  TaskStatus,
} from "../../shared/taskQueueTypes.ts";
import { getRedisQueueStore, type RedisQueueStore } from "./RedisQueueStore.ts";

interface RunningTask {
  task: QueueTask;
  abortController: AbortController;
  startTime: number;
}

interface TaskSchedulerConfig {
  debugMode?: boolean;
  redisUrl?: string;
}

/**
 * Executes a request via HTTP to a specific agent's API endpoint
 * Adapted from chat.ts executeAgentHttpRequest
 */
async function* executeAgentHttpRequest(
  agent: { id: string; apiEndpoint: string; workingDirectory: string },
  message: string,
  requestId: string,
  abortController: AbortController,
  claudeAuth?: ChatRequest["claudeAuth"],
  debugMode?: boolean
): AsyncGenerator<StreamResponse> {
  try {
    const agentChatRequest: ChatRequest = {
      message: message,
      requestId: requestId,
      workingDirectory: agent.workingDirectory,
      claudeAuth: claudeAuth,
    };

    if (debugMode) {
      console.debug(
        `[TaskScheduler] Making HTTP request to agent ${agent.id} at ${agent.apiEndpoint}`
      );
    }

    const response = await fetch(`${agent.apiEndpoint}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Connection: "keep-alive",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(agentChatRequest),
      signal: abortController.signal,
    });

    if (!response.ok) {
      const errorText = await response
        .text()
        .catch(() => "Unable to read error response");

      if (response.status === 401 || response.status === 403) {
        throw new Error(
          `Authentication failed for agent ${agent.id}. Status: ${response.status}`
        );
      } else if (response.status >= 500) {
        throw new Error(
          `Agent ${agent.id} server error (${response.status}): ${errorText}`
        );
      } else {
        throw new Error(
          `HTTP error from agent ${agent.id}! status: ${response.status}`
        );
      }
    }

    if (!response.body) {
      throw new Error("No response body from agent endpoint");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const readPromise = reader.read();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Stream read timeout after 30 seconds"));
          }, 30000);
        });

        const { done, value } = await Promise.race([
          readPromise,
          timeoutPromise,
        ]);

        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const streamResponse: StreamResponse = JSON.parse(line);
            yield streamResponse;

            if (
              streamResponse.type === "done" ||
              streamResponse.type === "error"
            ) {
              return;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield { type: "done" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      yield { type: "aborted" };
    } else {
      yield {
        type: "error",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export class TaskScheduler {
  private runningTasks: Map<string, RunningTask> = new Map();
  private completedResults: Map<string, TaskResult | TaskError> = new Map();
  private config: TaskSchedulerConfig;
  private isPaused: boolean = false;
  private isStopped: boolean = false;
  private redisStore: RedisQueueStore;
  private isRedisConnected: boolean = false;

  constructor(config: TaskSchedulerConfig = {}) {
    this.config = config;
    this.redisStore = getRedisQueueStore(config.redisUrl);
  }

  /**
   * Initialize Redis connection
   */
  async initRedis(): Promise<boolean> {
    await this.redisStore.connect();
    this.isRedisConnected = this.redisStore.isAvailable();
    if (this.isRedisConnected) {
      console.log("✅ TaskScheduler connected to Redis");
      // Recover any interrupted queues
      await this.recoverInterruptedQueues();
    }
    return this.isRedisConnected;
  }

  /**
   * Recover interrupted queues on startup
   */
  private async recoverInterruptedQueues(): Promise<void> {
    if (!this.isRedisConnected) return;

    const interrupted = await this.redisStore.loadInterruptedQueues();
    for (const queue of interrupted) {
      console.log(`🔄 Recovering interrupted queue: ${queue.name} (${queue.id})`);
      await this.redisStore.resetInterruptedQueue(queue.id);
    }
  }

  /**
   * Check if Redis is available
   */
  isRedisAvailable(): boolean {
    return this.isRedisConnected;
  }

  /**
   * Get Redis store for direct operations
   */
  getRedisStore(): RedisQueueStore {
    return this.redisStore;
  }

  /**
   * Start executing a queue
   */
  async *executeQueue(
    queue: TaskQueue,
    getAgent: (
      agentId: string
    ) => { id: string; apiEndpoint: string; workingDirectory: string } | undefined,
    claudeAuth?: ChatRequest["claudeAuth"]
  ): AsyncGenerator<TaskQueueEvent> {
    this.isPaused = false;
    this.isStopped = false;
    this.runningTasks.clear();
    this.completedResults.clear();

    // Update queue status in Redis
    if (this.isRedisConnected) {
      await this.redisStore.updateQueueStatus(queue.id, "running", Date.now());
    }

    const startEvent: TaskQueueEvent = { type: "queue_started", queueId: queue.id };
    if (this.isRedisConnected) {
      await this.redisStore.publishEvent(queue.id, startEvent);
    }
    yield startEvent;

    const { maxConcurrency, retryCount, retryDelay, timeoutPerTask } =
      queue.settings;

    while (this.hasWorkRemaining(queue) && !this.isStopped) {
      // Check if paused
      if (this.isPaused) {
        yield { type: "queue_paused", queueId: queue.id };
        // Wait until resumed or stopped
        while (this.isPaused && !this.isStopped) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (this.isStopped) break;
        yield { type: "queue_resumed", queueId: queue.id };
      }

      // Get tasks ready to execute
      const readyTasks = this.getReadyTasks(queue, maxConcurrency);

      if (readyTasks.length === 0) {
        // No tasks ready, wait for running tasks
        if (this.runningTasks.size > 0) {
          // Wait for at least one task to complete
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        // No tasks running and none ready - possible dependency deadlock or all done
        break;
      }

      // Start new tasks
      for (const task of readyTasks) {
        const agent = getAgent(task.agentId);
        if (!agent) {
          // Agent not found, mark task as failed
          task.status = "failed";
          task.error = {
            type: "execution",
            message: `Agent ${task.agentId} not found`,
            retryable: false,
            occurredAt: Date.now(),
          };
          yield {
            type: "task_failed",
            queueId: queue.id,
            taskId: task.id,
            error: task.error,
          };
          continue;
        }

        // Start the task
        this.startTask(
          queue,
          task,
          agent,
          claudeAuth,
          retryCount,
          retryDelay,
          timeoutPerTask
        );

        // Mark agent as busy in Redis
        if (this.isRedisConnected) {
          await this.redisStore.markAgentBusy(task.agentId);
          await this.redisStore.updateTask(task.id, { status: "in_progress", startedAt: Date.now() });
        }

        const taskStartEvent: TaskQueueEvent = {
          type: "task_started",
          queueId: queue.id,
          taskId: task.id,
          agentId: task.agentId,
        };
        if (this.isRedisConnected) {
          await this.redisStore.publishEvent(queue.id, taskStartEvent);
        }
        yield taskStartEvent;
      }

      // Check for completed tasks and yield events
      for (const [taskId, result] of Array.from(this.completedResults.entries())) {
        const task = queue.tasks.find((t) => t.id === taskId);
        if (!task) continue;

        // Mark agent as available
        if (this.isRedisConnected) {
          await this.redisStore.markAgentAvailable(task.agentId);
        }

        if ("content" in result) {
          // Success
          task.status = "completed";
          task.result = result as TaskResult;
          task.completedAt = Date.now();

          // Update Redis
          if (this.isRedisConnected) {
            await this.redisStore.updateTask(task.id, {
              status: "completed",
              completedAt: task.completedAt,
              result: task.result,
            });
          }

          const completedEvent: TaskQueueEvent = {
            type: "task_completed",
            queueId: queue.id,
            taskId: task.id,
            result: task.result,
          };
          if (this.isRedisConnected) {
            await this.redisStore.publishEvent(queue.id, completedEvent);
          }
          yield completedEvent;
        } else {
          // Error
          const error = result as TaskError;
          if (error.retryable && task.retryCount < task.maxRetries) {
            // Will retry
            task.status = "retrying";
            task.retryCount++;

            // Update Redis
            if (this.isRedisConnected) {
              await this.redisStore.updateTask(task.id, {
                status: "retrying",
                retryCount: task.retryCount,
              });
            }

            const retryEvent: TaskQueueEvent = {
              type: "task_retrying",
              queueId: queue.id,
              taskId: task.id,
              attempt: task.retryCount,
              maxRetries: task.maxRetries,
            };
            if (this.isRedisConnected) {
              await this.redisStore.publishEvent(queue.id, retryEvent);
              // Re-add to pending queue after delay
              setTimeout(async () => {
                task.status = "pending";
                await this.redisStore.requeueTask(queue.id, task.id);
              }, retryDelay * Math.pow(2, task.retryCount - 1));
            } else {
              // Reset to pending after delay (non-Redis fallback)
              setTimeout(() => {
                task.status = "pending";
              }, retryDelay * Math.pow(2, task.retryCount - 1));
            }
            yield retryEvent;
          } else {
            // Failed permanently
            task.status = "failed";
            task.error = error;
            task.completedAt = Date.now();

            // Update Redis
            if (this.isRedisConnected) {
              await this.redisStore.updateTask(task.id, {
                status: "failed",
                completedAt: task.completedAt,
                error: task.error,
              });
            }

            const failedEvent: TaskQueueEvent = {
              type: "task_failed",
              queueId: queue.id,
              taskId: task.id,
              error: task.error,
            };
            if (this.isRedisConnected) {
              await this.redisStore.publishEvent(queue.id, failedEvent);
            }
            yield failedEvent;
          }
        }
        this.completedResults.delete(taskId);
      }

      // Small delay to prevent busy loop
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Wait for any remaining running tasks
    while (this.runningTasks.size > 0 && !this.isStopped) {
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Process completed results
      for (const [taskId, result] of Array.from(this.completedResults.entries())) {
        const task = queue.tasks.find((t) => t.id === taskId);
        if (!task) continue;

        if ("content" in result) {
          task.status = "completed";
          task.result = result as TaskResult;
          task.completedAt = Date.now();
          yield {
            type: "task_completed",
            queueId: queue.id,
            taskId: task.id,
            result: task.result,
          };
        } else {
          task.status = "failed";
          task.error = result as TaskError;
          task.completedAt = Date.now();
          yield {
            type: "task_failed",
            queueId: queue.id,
            taskId: task.id,
            error: task.error,
          };
        }
        this.completedResults.delete(taskId);
      }
    }

    // Calculate final metrics
    const metrics = this.calculateMetrics(queue);
    queue.metrics = metrics;

    // Update metrics in Redis
    if (this.isRedisConnected) {
      await this.redisStore.updateQueueMetrics(queue.id, metrics);
    }

    if (this.isStopped) {
      const failedEvent: TaskQueueEvent = {
        type: "queue_failed",
        queueId: queue.id,
        error: "Queue was stopped",
      };
      if (this.isRedisConnected) {
        await this.redisStore.updateQueueStatus(queue.id, "failed");
        await this.redisStore.publishEvent(queue.id, failedEvent);
      }
      yield failedEvent;
    } else if (metrics.failedTasks > 0) {
      queue.status = "failed";
      const failedEvent: TaskQueueEvent = {
        type: "queue_failed",
        queueId: queue.id,
        error: `${metrics.failedTasks} task(s) failed`,
      };
      if (this.isRedisConnected) {
        await this.redisStore.updateQueueStatus(queue.id, "failed");
        await this.redisStore.publishEvent(queue.id, failedEvent);
      }
      yield failedEvent;
    } else {
      queue.status = "completed";
      queue.completedAt = Date.now();
      const completedEvent: TaskQueueEvent = {
        type: "queue_completed",
        queueId: queue.id,
        metrics,
      };
      if (this.isRedisConnected) {
        await this.redisStore.updateQueueStatus(queue.id, "completed", queue.completedAt);
        await this.redisStore.publishEvent(queue.id, completedEvent);
      }
      yield completedEvent;
    }
  }

  /**
   * Pause queue execution
   */
  pause(): void {
    this.isPaused = true;
  }

  /**
   * Resume queue execution
   */
  resume(): void {
    this.isPaused = false;
  }

  /**
   * Stop queue execution and abort all running tasks
   */
  stop(): void {
    this.isStopped = true;
    this.isPaused = false;

    // Abort all running tasks
    for (const [taskId, running] of Array.from(this.runningTasks.entries())) {
      running.abortController.abort();
      this.runningTasks.delete(taskId);
    }
  }

  /**
   * Check if there's work remaining
   */
  private hasWorkRemaining(queue: TaskQueue): boolean {
    return queue.tasks.some(
      (task) =>
        task.status === "pending" ||
        task.status === "queued" ||
        task.status === "in_progress" ||
        task.status === "retrying"
    );
  }

  /**
   * Get tasks that are ready to execute
   */
  private getReadyTasks(queue: TaskQueue, maxConcurrency: number): QueueTask[] {
    const currentRunning = this.runningTasks.size;
    const availableSlots = maxConcurrency - currentRunning;

    if (availableSlots <= 0) {
      return [];
    }

    // Find pending tasks (no dependencies in this simple version)
    const pendingTasks = queue.tasks.filter(
      (task) => task.status === "pending" || task.status === "queued"
    );

    // Sort by priority (lower number = higher priority)
    pendingTasks.sort((a, b) => a.priority - b.priority);

    return pendingTasks.slice(0, availableSlots);
  }

  /**
   * Start executing a single task
   */
  private startTask(
    queue: TaskQueue,
    task: QueueTask,
    agent: { id: string; apiEndpoint: string; workingDirectory: string },
    claudeAuth: ChatRequest["claudeAuth"] | undefined,
    maxRetries: number,
    retryDelay: number,
    timeout: number
  ): void {
    const abortController = new AbortController();
    const requestId = `${queue.id}-${task.id}-${Date.now()}`;

    task.status = "in_progress";
    task.startedAt = Date.now();
    task.maxRetries = maxRetries;

    this.runningTasks.set(task.id, {
      task,
      abortController,
      startTime: Date.now(),
    });

    // Execute in background
    this.executeTaskAsync(task, agent, requestId, abortController, claudeAuth, timeout)
      .then((result) => {
        this.runningTasks.delete(task.id);
        this.completedResults.set(task.id, result);
      })
      .catch((error) => {
        this.runningTasks.delete(task.id);
        this.completedResults.set(task.id, {
          type: "execution",
          message: error instanceof Error ? error.message : String(error),
          retryable: this.isRetryableError(error),
          occurredAt: Date.now(),
        });
      });
  }

  /**
   * Execute a task and aggregate the response
   */
  private async executeTaskAsync(
    task: QueueTask,
    agent: { id: string; apiEndpoint: string; workingDirectory: string },
    requestId: string,
    abortController: AbortController,
    claudeAuth: ChatRequest["claudeAuth"] | undefined,
    timeout: number
  ): Promise<TaskResult | TaskError> {
    let fullContent = "";
    let sessionId: string | undefined;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    try {
      for await (const response of executeAgentHttpRequest(
        agent,
        task.message,
        requestId,
        abortController,
        claudeAuth,
        this.config.debugMode
      )) {
        if (response.type === "claude_json" && response.data) {
          const data = response.data as {
            type?: string;
            sessionId?: string;
            message?: { content?: Array<{ text?: string }> };
          };

          // Extract session ID
          if (data.sessionId) {
            sessionId = data.sessionId;
          }

          // Extract text content
          if (data.type === "assistant" && data.message?.content) {
            for (const block of data.message.content) {
              if (block.text) {
                fullContent += block.text;
              }
            }
          }
        } else if (response.type === "error") {
          return {
            type: "execution",
            message: response.error || "Unknown error",
            retryable: true,
            occurredAt: Date.now(),
          };
        } else if (response.type === "aborted") {
          return {
            type: "abort",
            message: "Task was aborted",
            retryable: false,
            occurredAt: Date.now(),
          };
        }
      }

      return {
        type: "success",
        content: fullContent,
        sessionId,
        completedAt: Date.now(),
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (!(error instanceof Error)) return true;

    const message = error.message.toLowerCase();
    return (
      message.includes("timeout") ||
      message.includes("network") ||
      message.includes("econnrefused") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("429")
    );
  }

  /**
   * Calculate queue metrics
   */
  private calculateMetrics(queue: TaskQueue): TaskQueueMetrics {
    const tasks = queue.tasks;
    const completedTasks = tasks.filter((t) => t.status === "completed").length;
    const failedTasks = tasks.filter((t) => t.status === "failed").length;
    const pendingTasks = tasks.filter(
      (t) => t.status === "pending" || t.status === "queued"
    ).length;
    const inProgressTasks = tasks.filter(
      (t) => t.status === "in_progress"
    ).length;

    // Calculate average duration for completed tasks
    const completedWithDuration = tasks.filter(
      (t) => t.status === "completed" && t.startedAt && t.completedAt
    );
    const averageTaskDuration =
      completedWithDuration.length > 0
        ? completedWithDuration.reduce(
            (sum, t) => sum + ((t.completedAt || 0) - (t.startedAt || 0)),
            0
          ) / completedWithDuration.length
        : undefined;

    return {
      totalTasks: tasks.length,
      completedTasks,
      failedTasks,
      pendingTasks,
      inProgressTasks,
      averageTaskDuration,
    };
  }
}

// Singleton instance for the app
let schedulerInstance: TaskScheduler | null = null;

export function getTaskScheduler(config?: TaskSchedulerConfig): TaskScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new TaskScheduler(config);
  }
  return schedulerInstance;
}

export function createTaskScheduler(config?: TaskSchedulerConfig): TaskScheduler {
  return new TaskScheduler(config);
}
