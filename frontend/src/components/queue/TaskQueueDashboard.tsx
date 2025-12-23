import { Pause, Play, StopCircle, Plus, ListTodo, Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { TaskQueue, QueueListItem } from "../../../../shared/taskQueueTypes";
import { useAgentConfig } from "../../hooks/useAgentConfig";
import { TaskCard } from "./TaskCard";

interface TaskQueueDashboardProps {
  queue: TaskQueue | null;
  queueList: QueueListItem[];
  isLoading: boolean;
  error: string | null;
  onLoadQueue: (queueId: string) => Promise<TaskQueue | null>;
  onStartQueue: (queueId: string) => Promise<void>;
  onPauseQueue: (queueId: string) => Promise<void>;
  onResumeQueue: (queueId: string) => Promise<void>;
  onCancelQueue: (queueId: string) => Promise<void>;
  onRetryTask: (queueId: string, taskId: string) => Promise<void>;
  onSkipTask: (queueId: string, taskId: string) => void;
  onNewQueue: () => void;
}

export function TaskQueueDashboard({
  queue,
  queueList,
  isLoading,
  error,
  onLoadQueue,
  onStartQueue,
  onPauseQueue,
  onResumeQueue,
  onCancelQueue,
  onRetryTask,
  onSkipTask,
  onNewQueue,
}: TaskQueueDashboardProps) {
  const { agents } = useAgentConfig();
  const getAgentById = (id: string) => agents.find((a) => a.id === id);

  // If no active queue, show queue list
  if (!queue) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          background: "var(--claude-bg)",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px",
            borderBottom: "1px solid var(--claude-border)",
            background: "var(--claude-message-bg)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  margin: 0,
                  color: "var(--claude-text-primary)",
                }}
              >
                Task Queues
              </h2>
              <p
                style={{
                  fontSize: "13px",
                  color: "var(--claude-text-tertiary)",
                  marginTop: "4px",
                }}
              >
                Manage parallel task execution across agents
              </p>
            </div>
            <button
              onClick={onNewQueue}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "10px 16px",
                borderRadius: "8px",
                border: "none",
                background: "var(--claude-accent)",
                color: "white",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              <Plus size={16} />
              New Queue
            </button>
          </div>
        </div>

        {/* Queue List or Empty State */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "20px",
          }}
        >
          {isLoading ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "200px",
                color: "var(--claude-text-tertiary)",
              }}
            >
              <Loader2 size={32} style={{ animation: "spin 1s linear infinite" }} />
              <p style={{ marginTop: "12px" }}>Loading queues...</p>
            </div>
          ) : error ? (
            <div
              style={{
                padding: "20px",
                background: "rgba(239, 68, 68, 0.1)",
                borderRadius: "8px",
                color: "#ef4444",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          ) : queueList.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "300px",
                color: "var(--claude-text-tertiary)",
              }}
            >
              <ListTodo size={48} strokeWidth={1.5} />
              <h3
                style={{
                  fontSize: "16px",
                  fontWeight: 500,
                  marginTop: "16px",
                  marginBottom: "8px",
                  color: "var(--claude-text-secondary)",
                }}
              >
                No task queues yet
              </h3>
              <p style={{ fontSize: "13px", marginBottom: "20px" }}>
                Create a queue to distribute tasks across your agents
              </p>
              <button
                onClick={onNewQueue}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  border: "1px solid var(--claude-border)",
                  background: "transparent",
                  color: "var(--claude-text-primary)",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <Plus size={16} />
                Create First Queue
              </button>
            </div>
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              {queueList.map((item) => (
                <QueueListCard
                  key={item.id}
                  item={item}
                  onSelect={() => onLoadQueue(item.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Active Queue View
  const tasksByAgent = queue.tasks.reduce(
    (acc, task) => {
      if (!acc[task.agentId]) {
        acc[task.agentId] = [];
      }
      acc[task.agentId].push(task);
      return acc;
    },
    {} as Record<string, typeof queue.tasks>
  );

  const { metrics } = queue;
  const progress = metrics.totalTasks > 0
    ? Math.round((metrics.completedTasks / metrics.totalTasks) * 100)
    : 0;

  const getStatusColor = () => {
    switch (queue.status) {
      case "running":
        return "#3b82f6";
      case "paused":
        return "#f59e0b";
      case "completed":
        return "#22c55e";
      case "failed":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--claude-bg)",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid var(--claude-border)",
          background: "var(--claude-message-bg)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "16px",
          }}
        >
          <div>
            <h2
              style={{
                fontSize: "16px",
                fontWeight: 600,
                margin: 0,
                color: "var(--claude-text-primary)",
              }}
            >
              {queue.name}
            </h2>
            <div
              style={{
                fontSize: "12px",
                color: "var(--claude-text-tertiary)",
                marginTop: "2px",
              }}
            >
              {queue.tasks.length} tasks
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", gap: "8px" }}>
            {queue.status === "running" && (
              <button
                onClick={() => onPauseQueue(queue.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "none",
                  background: "#f59e0b",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <Pause size={16} />
                Pause
              </button>
            )}
            {queue.status === "paused" && (
              <button
                onClick={() => onResumeQueue(queue.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--claude-accent)",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <Play size={16} />
                Resume
              </button>
            )}
            {(queue.status === "running" || queue.status === "paused") && (
              <button
                onClick={() => onCancelQueue(queue.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "1px solid #ef4444",
                  background: "transparent",
                  color: "#ef4444",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <StopCircle size={16} />
                Abort
              </button>
            )}
            {(queue.status === "completed" || queue.status === "failed" || queue.status === "idle") && (
              <button
                onClick={onNewQueue}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "8px 14px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--claude-accent)",
                  color: "white",
                  fontSize: "13px",
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                <Plus size={16} />
                New Queue
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 500,
                  color: getStatusColor(),
                  textTransform: "capitalize",
                }}
              >
                {queue.status}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  color: "var(--claude-text-tertiary)",
                }}
              >
                {metrics.completedTasks}/{metrics.totalTasks} completed
              </span>
              {metrics.failedTasks > 0 && (
                <span
                  style={{
                    fontSize: "12px",
                    color: "#ef4444",
                  }}
                >
                  ({metrics.failedTasks} failed)
                </span>
              )}
            </div>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "var(--claude-text-primary)",
              }}
            >
              {progress}%
            </span>
          </div>
          <div
            style={{
              height: "6px",
              borderRadius: "3px",
              background: "var(--claude-border)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${progress}%`,
                background: getStatusColor(),
                borderRadius: "3px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      </div>

      {/* Tasks Grid */}
      <div
        style={{
          flex: 1,
          overflow: "auto",
          padding: "20px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(350px, 1fr))",
            gap: "20px",
          }}
        >
          {Object.entries(tasksByAgent).map(([agentId, tasks]) => {
            const agent = getAgentById(agentId);
            return (
              <div key={agentId}>
                {/* Agent Header */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    marginBottom: "12px",
                    paddingBottom: "8px",
                    borderBottom: "1px solid var(--claude-border)",
                  }}
                >
                  <div
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      background: agent?.color || "#6b7280",
                    }}
                  />
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: 600,
                      color: "var(--claude-text-primary)",
                    }}
                  >
                    {agent?.name || agentId}
                  </span>
                  <span
                    style={{
                      fontSize: "11px",
                      color: "var(--claude-text-tertiary)",
                    }}
                  >
                    ({tasks.length} {tasks.length === 1 ? "task" : "tasks"})
                  </span>
                </div>

                {/* Task Cards */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                  }}
                >
                  {tasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agent={agent}
                      onRetry={() => onRetryTask(queue.id, task.id)}
                      onSkip={() => onSkipTask(queue.id, task.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Queue List Card Component
function QueueListCard({
  item,
  onSelect,
}: {
  item: QueueListItem;
  onSelect: () => void;
}) {
  const getStatusIcon = () => {
    switch (item.status) {
      case "running":
        return <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} color="#3b82f6" />;
      case "paused":
        return <Pause size={16} color="#f59e0b" />;
      case "completed":
        return <CheckCircle2 size={16} color="#22c55e" />;
      case "failed":
        return <XCircle size={16} color="#ef4444" />;
      default:
        return <Clock size={16} color="#6b7280" />;
    }
  };

  const getStatusColor = () => {
    switch (item.status) {
      case "running":
        return "#3b82f6";
      case "paused":
        return "#f59e0b";
      case "completed":
        return "#22c55e";
      case "failed":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  const progress = item.taskCount > 0
    ? Math.round((item.completedCount / item.taskCount) * 100)
    : 0;

  return (
    <button
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "16px",
        background: "var(--claude-message-bg)",
        border: "1px solid var(--claude-border)",
        borderRadius: "10px",
        cursor: "pointer",
        textAlign: "left",
        width: "100%",
        transition: "border-color 0.2s, background 0.2s",
      }}
      onMouseOver={(e) => {
        e.currentTarget.style.borderColor = "var(--claude-text-tertiary)";
      }}
      onMouseOut={(e) => {
        e.currentTarget.style.borderColor = "var(--claude-border)";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {getStatusIcon()}
        <div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 500,
              color: "var(--claude-text-primary)",
            }}
          >
            {item.name}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--claude-text-tertiary)",
              marginTop: "2px",
            }}
          >
            {item.taskCount} tasks • Created{" "}
            {new Date(item.createdAt).toLocaleDateString()}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        {/* Progress */}
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: getStatusColor(),
              textTransform: "capitalize",
            }}
          >
            {item.status}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "var(--claude-text-tertiary)",
              marginTop: "2px",
            }}
          >
            {item.completedCount}/{item.taskCount} ({progress}%)
          </div>
        </div>

        {/* Mini progress bar */}
        <div
          style={{
            width: "60px",
            height: "4px",
            borderRadius: "2px",
            background: "var(--claude-border)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progress}%`,
              background: getStatusColor(),
              borderRadius: "2px",
            }}
          />
        </div>
      </div>
    </button>
  );
}
