import { useState } from "react";
import { Plus, Trash2, Play } from "lucide-react";
import type { Agent } from "../../hooks/useAgentConfig";
import type { TaskInput, TaskComplexity } from "../../../../shared/taskQueueTypes";

interface TaskDraft {
  id: string;
  agentId: string;
  message: string;
  priority: number;
  estimatedComplexity?: TaskComplexity;
}

interface ManualAssignmentTabProps {
  agents: Agent[];
  onSubmit: (tasks: TaskInput[]) => Promise<void>;
  isSubmitting: boolean;
}

export function ManualAssignmentTab({
  agents,
  onSubmit,
  isSubmitting,
}: ManualAssignmentTabProps) {
  const [tasks, setTasks] = useState<TaskDraft[]>([
    {
      id: `draft-${Date.now()}`,
      agentId: agents[0]?.id || "",
      message: "",
      priority: 1,
    },
  ]);

  const addTask = () => {
    setTasks([
      ...tasks,
      {
        id: `draft-${Date.now()}-${tasks.length}`,
        agentId: agents[0]?.id || "",
        message: "",
        priority: tasks.length + 1,
      },
    ]);
  };

  const removeTask = (taskId: string) => {
    if (tasks.length <= 1) return;
    setTasks(tasks.filter((t) => t.id !== taskId));
  };

  const updateTask = (taskId: string, updates: Partial<TaskDraft>) => {
    setTasks(
      tasks.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
    );
  };

  const handleSubmit = () => {
    const validTasks = tasks.filter((t) => t.agentId && t.message.trim());
    if (validTasks.length === 0) return;

    const taskInputs: TaskInput[] = validTasks.map((t) => ({
      agentId: t.agentId,
      message: t.message.trim(),
      priority: t.priority,
      estimatedComplexity: t.estimatedComplexity,
    }));

    onSubmit(taskInputs);
  };

  const getAgentById = (id: string) => agents.find((a) => a.id === id);

  return (
    <div>
      {/* Tasks List */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {tasks.map((task, index) => (
          <div
            key={task.id}
            style={{
              padding: "16px",
              borderRadius: "10px",
              border: "1px solid var(--claude-border)",
              background: "var(--claude-bg)",
            }}
          >
            {/* Task Header */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "12px",
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--claude-text-primary)",
                }}
              >
                Task {index + 1}
              </span>
              {tasks.length > 1 && (
                <button
                  onClick={() => removeTask(task.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "4px",
                    color: "#ef4444",
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>

            {/* Agent Selector */}
            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  marginBottom: "4px",
                  color: "var(--claude-text-secondary)",
                }}
              >
                Agent
              </label>
              <select
                value={task.agentId}
                onChange={(e) => updateTask(task.id, { agentId: e.target.value })}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--claude-border)",
                  background: "var(--claude-message-bg)",
                  color: "var(--claude-text-primary)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
              {task.agentId && (
                <div
                  style={{
                    marginTop: "4px",
                    fontSize: "11px",
                    color: "var(--claude-text-tertiary)",
                  }}
                >
                  {getAgentById(task.agentId)?.description}
                </div>
              )}
            </div>

            {/* Task Message */}
            <div style={{ marginBottom: "12px" }}>
              <label
                style={{
                  display: "block",
                  fontSize: "12px",
                  fontWeight: 500,
                  marginBottom: "4px",
                  color: "var(--claude-text-secondary)",
                }}
              >
                Task Instructions
              </label>
              <textarea
                value={task.message}
                onChange={(e) => updateTask(task.id, { message: e.target.value })}
                placeholder="Describe what this agent should do..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "6px",
                  border: "1px solid var(--claude-border)",
                  background: "var(--claude-message-bg)",
                  color: "var(--claude-text-primary)",
                  fontSize: "13px",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
            </div>

            {/* Priority & Complexity */}
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 500,
                    marginBottom: "4px",
                    color: "var(--claude-text-secondary)",
                  }}
                >
                  Priority (1-10)
                </label>
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={task.priority}
                  onChange={(e) =>
                    updateTask(task.id, {
                      priority: Math.min(10, Math.max(1, parseInt(e.target.value) || 1)),
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--claude-border)",
                    background: "var(--claude-message-bg)",
                    color: "var(--claude-text-primary)",
                    fontSize: "13px",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 500,
                    marginBottom: "4px",
                    color: "var(--claude-text-secondary)",
                  }}
                >
                  Complexity
                </label>
                <select
                  value={task.estimatedComplexity || ""}
                  onChange={(e) =>
                    updateTask(task.id, {
                      estimatedComplexity: (e.target.value || undefined) as TaskComplexity | undefined,
                    })
                  }
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--claude-border)",
                    background: "var(--claude-message-bg)",
                    color: "var(--claude-text-primary)",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Auto</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Task Button */}
      <button
        onClick={addTask}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
          width: "100%",
          padding: "12px",
          marginTop: "16px",
          borderRadius: "8px",
          border: "1px dashed var(--claude-border)",
          background: "transparent",
          color: "var(--claude-text-secondary)",
          fontSize: "13px",
          cursor: "pointer",
        }}
      >
        <Plus size={16} />
        Add Another Task
      </button>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || tasks.every((t) => !t.message.trim())}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          width: "100%",
          padding: "14px",
          marginTop: "20px",
          borderRadius: "8px",
          border: "none",
          background: "var(--claude-accent)",
          color: "white",
          fontSize: "14px",
          fontWeight: 600,
          cursor: isSubmitting ? "not-allowed" : "pointer",
          opacity: isSubmitting ? 0.7 : 1,
        }}
      >
        <Play size={18} />
        {isSubmitting ? "Creating Queue..." : "Create & Execute Queue"}
      </button>
    </div>
  );
}
