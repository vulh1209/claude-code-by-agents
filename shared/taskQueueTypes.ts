/**
 * Task Queue Types
 * Defines types for parallel task execution across multiple agents
 */

// Task status lifecycle
export type TaskStatus =
  | "pending" // Task created, awaiting execution
  | "queued" // Task in queue, ready for execution
  | "in_progress" // Currently being executed by an agent
  | "completed" // Successfully finished
  | "failed" // Execution failed
  | "retrying" // Failed but retrying
  | "cancelled"; // User cancelled

// Complexity estimation from AI
export type TaskComplexity = "low" | "medium" | "high";

// Error types for failed tasks
export type TaskErrorType = "execution" | "timeout" | "network" | "abort";

// Task result on success
export interface TaskResult {
  type: "success" | "partial";
  content: string;
  sessionId?: string;
  completedAt: number;
}

// Task error on failure
export interface TaskError {
  type: TaskErrorType;
  message: string;
  retryable: boolean;
  occurredAt: number;
  stack?: string;
}

// Task metadata
export interface TaskMetadata {
  parentQueueId: string;
  createdBy: "orchestrator" | "user";
  requestId?: string;
  sessionId?: string;
}

// Individual task in the queue
export interface QueueTask {
  id: string;
  agentId: string;
  message: string;
  status: TaskStatus;

  // Priority and complexity (from AI estimation or user input)
  priority: number; // 1 (highest) to 10 (lowest)
  estimatedComplexity?: TaskComplexity;

  // Retry tracking
  retryCount: number;
  maxRetries: number;

  // Timestamps
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  // Results and errors
  result?: TaskResult;
  error?: TaskError;

  // Metadata
  metadata?: TaskMetadata;
}

// Queue settings
export interface TaskQueueSettings {
  maxConcurrency: number; // Max parallel tasks (default: 3)
  retryCount: number; // Default retries per task (default: 3)
  retryDelay: number; // ms between retries (default: 2000)
  timeoutPerTask: number; // ms before task timeout (default: 300000 = 5 min)
}

// Queue metrics for progress tracking
export interface TaskQueueMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  pendingTasks: number;
  inProgressTasks: number;
  averageTaskDuration?: number;
  estimatedTimeRemaining?: number;
}

// Queue status
export type QueueStatus = "idle" | "running" | "paused" | "completed" | "failed";

// The main queue containing multiple tasks
export interface TaskQueue {
  id: string;
  name: string;
  description?: string;

  tasks: QueueTask[];

  // Queue-level settings
  settings: TaskQueueSettings;

  // Status
  status: QueueStatus;

  // Timestamps
  createdAt: number;
  startedAt?: number;
  completedAt?: number;

  // Metrics
  metrics: TaskQueueMetrics;
}

// Default settings
export const DEFAULT_QUEUE_SETTINGS: TaskQueueSettings = {
  maxConcurrency: 3,
  retryCount: 3,
  retryDelay: 2000,
  timeoutPerTask: 300000, // 5 minutes
};

// ============================================
// API Request/Response Types
// ============================================

// Task input for creating queue
export interface TaskInput {
  agentId: string;
  message: string;
  priority?: number;
  estimatedComplexity?: TaskComplexity;
}

// POST /api/queue - Create queue request
export interface CreateQueueRequest {
  name: string;
  description?: string;
  tasks: TaskInput[];
  settings?: Partial<TaskQueueSettings>;
}

// POST /api/queue - Create queue response
export interface CreateQueueResponse {
  queueId: string;
  queue: TaskQueue;
}

// GET /api/queue/:queueId - Get queue response
export interface GetQueueResponse {
  queue: TaskQueue;
}

// POST /api/queue/:queueId/start - Start queue response
export interface StartQueueResponse {
  queueId: string;
  status: "running";
  streamUrl: string;
}

// Queue list item for listing queues
export interface QueueListItem {
  id: string;
  name: string;
  status: QueueStatus;
  taskCount: number;
  completedCount: number;
  createdAt: number;
}

// GET /api/queues - List queues response
export interface ListQueuesResponse {
  queues: QueueListItem[];
}

// ============================================
// SSE Event Types for Real-time Updates
// ============================================

export type TaskQueueEventType =
  | "queue_created"
  | "queue_started"
  | "queue_paused"
  | "queue_resumed"
  | "queue_completed"
  | "queue_failed"
  | "task_started"
  | "task_progress"
  | "task_completed"
  | "task_failed"
  | "task_retrying";

export interface QueueCreatedEvent {
  type: "queue_created";
  queue: TaskQueue;
}

export interface QueueStartedEvent {
  type: "queue_started";
  queueId: string;
}

export interface QueuePausedEvent {
  type: "queue_paused";
  queueId: string;
}

export interface QueueResumedEvent {
  type: "queue_resumed";
  queueId: string;
}

export interface QueueCompletedEvent {
  type: "queue_completed";
  queueId: string;
  metrics: TaskQueueMetrics;
}

export interface QueueFailedEvent {
  type: "queue_failed";
  queueId: string;
  error: string;
}

export interface TaskStartedEvent {
  type: "task_started";
  queueId: string;
  taskId: string;
  agentId: string;
}

export interface TaskProgressEvent {
  type: "task_progress";
  queueId: string;
  taskId: string;
  content: string;
}

export interface TaskCompletedEvent {
  type: "task_completed";
  queueId: string;
  taskId: string;
  result: TaskResult;
}

export interface TaskFailedEvent {
  type: "task_failed";
  queueId: string;
  taskId: string;
  error: TaskError;
}

export interface TaskRetryingEvent {
  type: "task_retrying";
  queueId: string;
  taskId: string;
  attempt: number;
  maxRetries: number;
}

export type TaskQueueEvent =
  | QueueCreatedEvent
  | QueueStartedEvent
  | QueuePausedEvent
  | QueueResumedEvent
  | QueueCompletedEvent
  | QueueFailedEvent
  | TaskStartedEvent
  | TaskProgressEvent
  | TaskCompletedEvent
  | TaskFailedEvent
  | TaskRetryingEvent;

// ============================================
// AI Orchestrator Types
// ============================================

// AI task split result
export interface AITaskSplit {
  agentId: string;
  agentName: string;
  message: string;
  priority: number;
  estimatedComplexity: TaskComplexity;
  reasoning?: string; // Why this agent was chosen
}

// AI split request
export interface AISplitRequest {
  taskDescription: string;
  availableAgents: Array<{
    id: string;
    name: string;
    description: string;
    workingDirectory: string;
  }>;
}

// AI split response
export interface AISplitResponse {
  splits: AITaskSplit[];
  overallStrategy?: string;
}
