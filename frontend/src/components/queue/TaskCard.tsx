import { RefreshCw, Play, AlertCircle, CheckCircle, Clock, Loader2, SkipForward } from "lucide-react";
import type { QueueTask, TaskStatus } from "../../../../shared/taskQueueTypes";
import type { Agent } from "../../hooks/useAgentConfig";

interface TaskCardProps {
  task: QueueTask;
  agent?: Agent;
  onRetry?: () => void;
  onSkip?: () => void;
  onViewChat?: () => void;
}

const getStatusConfig = (status: TaskStatus) => {
  switch (status) {
    case "pending":
    case "queued":
      return {
        icon: Clock,
        color: "#6b7280",
        bgColor: "rgba(107, 114, 128, 0.1)",
        label: "Pending",
      };
    case "in_progress":
      return {
        icon: Loader2,
        color: "#3b82f6",
        bgColor: "rgba(59, 130, 246, 0.1)",
        label: "Running",
        animate: true,
      };
    case "completed":
      return {
        icon: CheckCircle,
        color: "#22c55e",
        bgColor: "rgba(34, 197, 94, 0.1)",
        label: "Completed",
      };
    case "failed":
      return {
        icon: AlertCircle,
        color: "#ef4444",
        bgColor: "rgba(239, 68, 68, 0.1)",
        label: "Failed",
      };
    case "retrying":
      return {
        icon: RefreshCw,
        color: "#f59e0b",
        bgColor: "rgba(245, 158, 11, 0.1)",
        label: "Retrying",
        animate: true,
      };
    case "cancelled":
      return {
        icon: SkipForward,
        color: "#6b7280",
        bgColor: "rgba(107, 114, 128, 0.1)",
        label: "Skipped",
      };
    default:
      return {
        icon: Clock,
        color: "#6b7280",
        bgColor: "rgba(107, 114, 128, 0.1)",
        label: status,
      };
  }
};

export function TaskCard({ task, agent, onRetry, onSkip, onViewChat }: TaskCardProps) {
  const statusConfig = getStatusConfig(task.status);
  const StatusIcon = statusConfig.icon;

  const getComplexityBadge = () => {
    if (!task.estimatedComplexity) return null;
    const colors: Record<string, string> = {
      low: "#22c55e",
      medium: "#f59e0b",
      high: "#ef4444",
    };
    return (
      <span
        style={{
          padding: "2px 6px",
          borderRadius: "4px",
          fontSize: "10px",
          fontWeight: 500,
          background: `${colors[task.estimatedComplexity]}20`,
          color: colors[task.estimatedComplexity],
          textTransform: "capitalize",
        }}
      >
        {task.estimatedComplexity}
      </span>
    );
  };

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: "10px",
        border: `1px solid ${
          task.status === "in_progress"
            ? "var(--claude-accent)"
            : "var(--claude-border)"
        }`,
        background: statusConfig.bgColor,
        transition: "all 0.2s ease",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Agent Name */}
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: "var(--claude-text-primary)",
            }}
          >
            {agent?.name || task.agentId}
          </span>

          {/* Complexity Badge */}
          {getComplexityBadge()}

          {/* Priority */}
          <span
            style={{
              fontSize: "10px",
              color: "var(--claude-text-tertiary)",
            }}
          >
            P{task.priority}
          </span>
        </div>

        {/* Status Badge */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            padding: "4px 10px",
            borderRadius: "6px",
            background: statusConfig.bgColor,
            border: `1px solid ${statusConfig.color}40`,
          }}
        >
          <StatusIcon
            size={14}
            style={{
              color: statusConfig.color,
              animation: statusConfig.animate ? "spin 1s linear infinite" : undefined,
            }}
          />
          <span
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: statusConfig.color,
            }}
          >
            {statusConfig.label}
          </span>
          {task.status === "retrying" && (
            <span
              style={{
                fontSize: "10px",
                color: statusConfig.color,
              }}
            >
              ({task.retryCount}/{task.maxRetries})
            </span>
          )}
        </div>
      </div>

      {/* Task Message */}
      <p
        style={{
          margin: 0,
          fontSize: "13px",
          color: "var(--claude-text-secondary)",
          lineHeight: 1.5,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {task.message}
      </p>

      {/* Error Message */}
      {task.error && (
        <div
          style={{
            marginTop: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              fontWeight: 500,
              color: "#ef4444",
              marginBottom: "4px",
            }}
          >
            Error: {task.error.type}
          </div>
          <div
            style={{
              fontSize: "11px",
              color: "#ef4444",
              opacity: 0.8,
            }}
          >
            {task.error.message}
          </div>
        </div>
      )}

      {/* Result Preview */}
      {task.result && task.status === "completed" && (
        <div
          style={{
            marginTop: "10px",
            padding: "8px 12px",
            borderRadius: "6px",
            background: "rgba(34, 197, 94, 0.1)",
            border: "1px solid rgba(34, 197, 94, 0.3)",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "#22c55e",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {task.result.content.slice(0, 150)}
            {task.result.content.length > 150 ? "..." : ""}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      {(task.status === "failed" || task.status === "completed") && (
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginTop: "12px",
          }}
        >
          {task.status === "failed" && (
            <>
              {onRetry && (
                <button
                  onClick={onRetry}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "none",
                    background: "var(--claude-accent)",
                    color: "white",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <RefreshCw size={14} />
                  Retry
                </button>
              )}
              {onSkip && (
                <button
                  onClick={onSkip}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--claude-border)",
                    background: "transparent",
                    color: "var(--claude-text-secondary)",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  <SkipForward size={14} />
                  Skip
                </button>
              )}
            </>
          )}
          {onViewChat && (
            <button
              onClick={onViewChat}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--claude-border)",
                background: "transparent",
                color: "var(--claude-text-secondary)",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              View Details
            </button>
          )}
        </div>
      )}

      {/* CSS for spin animation */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
