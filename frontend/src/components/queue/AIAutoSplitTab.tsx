import { useState } from "react";
import { Wand2, Play, RefreshCw, Edit3, Check, X } from "lucide-react";
import type { Agent } from "../../hooks/useAgentConfig";
import type { TaskInput, AITaskSplit, TaskComplexity } from "../../../../shared/taskQueueTypes";

interface AIAutoSplitTabProps {
  agents: Agent[];
  orchestratorEndpoint?: string;
  onSubmit: (tasks: TaskInput[]) => Promise<void>;
  isSubmitting: boolean;
}

interface EditingTask extends AITaskSplit {
  isEditing?: boolean;
}

export function AIAutoSplitTab({
  agents,
  orchestratorEndpoint,
  onSubmit,
  isSubmitting,
}: AIAutoSplitTabProps) {
  const [taskDescription, setTaskDescription] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [proposedTasks, setProposedTasks] = useState<EditingTask[]>([]);
  const [overallStrategy, setOverallStrategy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getComplexityColor = (complexity: TaskComplexity) => {
    switch (complexity) {
      case "low":
        return "#22c55e";
      case "medium":
        return "#f59e0b";
      case "high":
        return "#ef4444";
      default:
        return "var(--claude-text-secondary)";
    }
  };

  const handleAnalyze = async () => {
    if (!taskDescription.trim()) {
      setError("Please describe your task first");
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setProposedTasks([]);

    try {
      // For now, simulate AI analysis with a simple heuristic
      // In production, this would call the orchestrator API
      const splits = simulateAISplit(taskDescription, agents);
      setProposedTasks(splits);
      setOverallStrategy(
        "The task has been divided based on agent specializations. " +
          "Tasks will run in parallel for maximum efficiency."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to analyze task");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const simulateAISplit = (description: string, availableAgents: Agent[]): EditingTask[] => {
    // Simple heuristic-based splitting for demo
    // In production, this would use the orchestrator AI
    const words = description.toLowerCase();
    const splits: EditingTask[] = [];

    availableAgents.forEach((agent, index) => {
      // Check if the description mentions this agent's specialty
      const agentKeywords = agent.description.toLowerCase().split(/\s+/);
      const relevanceScore = agentKeywords.filter((kw) =>
        words.includes(kw) && kw.length > 3
      ).length;

      if (relevanceScore > 0 || index < 2) {
        splits.push({
          agentId: agent.id,
          agentName: agent.name,
          message: `Implement the ${agent.name.toLowerCase()} portion of: ${description.slice(0, 100)}${description.length > 100 ? "..." : ""}`,
          priority: index + 1,
          estimatedComplexity: index === 0 ? "high" : index === 1 ? "medium" : "low",
          reasoning: `${agent.name} is best suited for this part of the task based on its specialization.`,
        });
      }
    });

    // If no matches, assign to first two agents
    if (splits.length === 0 && availableAgents.length > 0) {
      splits.push({
        agentId: availableAgents[0].id,
        agentName: availableAgents[0].name,
        message: description,
        priority: 1,
        estimatedComplexity: "medium",
        reasoning: "Default assignment to primary agent.",
      });
    }

    return splits;
  };

  const updateTask = (agentId: string, updates: Partial<EditingTask>) => {
    setProposedTasks(
      proposedTasks.map((t) =>
        t.agentId === agentId ? { ...t, ...updates } : t
      )
    );
  };

  const removeTask = (agentId: string) => {
    setProposedTasks(proposedTasks.filter((t) => t.agentId !== agentId));
  };

  const handleSubmit = () => {
    if (proposedTasks.length === 0) return;

    const taskInputs: TaskInput[] = proposedTasks.map((t) => ({
      agentId: t.agentId,
      message: t.message,
      priority: t.priority,
      estimatedComplexity: t.estimatedComplexity,
    }));

    onSubmit(taskInputs);
  };

  return (
    <div>
      {/* Task Description Input */}
      <div style={{ marginBottom: "20px" }}>
        <label
          style={{
            display: "block",
            fontSize: "13px",
            fontWeight: 500,
            marginBottom: "8px",
            color: "var(--claude-text-primary)",
          }}
        >
          Describe your task
        </label>
        <textarea
          value={taskDescription}
          onChange={(e) => setTaskDescription(e.target.value)}
          placeholder="Describe the complex task you want to accomplish. The AI will analyze it and suggest how to split it across your agents..."
          rows={4}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: "8px",
            border: "1px solid var(--claude-border)",
            background: "var(--claude-bg)",
            color: "var(--claude-text-primary)",
            fontSize: "14px",
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
      </div>

      {/* Analyze Button */}
      {proposedTasks.length === 0 && (
        <button
          onClick={handleAnalyze}
          disabled={isAnalyzing || !taskDescription.trim()}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            width: "100%",
            padding: "12px",
            borderRadius: "8px",
            border: "none",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            color: "white",
            fontSize: "14px",
            fontWeight: 600,
            cursor: isAnalyzing ? "not-allowed" : "pointer",
            opacity: isAnalyzing ? 0.7 : 1,
          }}
        >
          {isAnalyzing ? (
            <>
              <RefreshCw size={18} className="animate-spin" />
              Analyzing Task...
            </>
          ) : (
            <>
              <Wand2 size={18} />
              Analyze & Split Task
            </>
          )}
        </button>
      )}

      {/* Error Display */}
      {error && (
        <div
          style={{
            padding: "10px 14px",
            marginTop: "16px",
            borderRadius: "8px",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#ef4444",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      )}

      {/* Proposed Tasks */}
      {proposedTasks.length > 0 && (
        <div style={{ marginTop: "20px" }}>
          {/* Strategy Summary */}
          {overallStrategy && (
            <div
              style={{
                padding: "12px 16px",
                marginBottom: "16px",
                borderRadius: "8px",
                background: "rgba(99, 102, 241, 0.1)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                fontSize: "13px",
                color: "var(--claude-text-primary)",
              }}
            >
              <strong style={{ color: "#6366f1" }}>Strategy: </strong>
              {overallStrategy}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <h3
              style={{
                fontSize: "14px",
                fontWeight: 600,
                margin: 0,
                color: "var(--claude-text-primary)",
              }}
            >
              Proposed Task Distribution ({proposedTasks.length} tasks)
            </h3>
            <button
              onClick={handleAnalyze}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                padding: "6px 10px",
                borderRadius: "6px",
                border: "1px solid var(--claude-border)",
                background: "transparent",
                color: "var(--claude-text-secondary)",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              <RefreshCw size={14} />
              Re-analyze
            </button>
          </div>

          {/* Task Cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {proposedTasks.map((task) => (
              <div
                key={task.agentId}
                style={{
                  padding: "14px 16px",
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
                    marginBottom: "10px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: 600,
                        color: "var(--claude-text-primary)",
                      }}
                    >
                      {task.agentName}
                    </span>
                    <span
                      style={{
                        padding: "2px 8px",
                        borderRadius: "4px",
                        fontSize: "11px",
                        fontWeight: 500,
                        background: `${getComplexityColor(task.estimatedComplexity)}20`,
                        color: getComplexityColor(task.estimatedComplexity),
                      }}
                    >
                      {task.estimatedComplexity}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        color: "var(--claude-text-tertiary)",
                      }}
                    >
                      Priority: {task.priority}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    <button
                      onClick={() => updateTask(task.agentId, { isEditing: !task.isEditing })}
                      style={{
                        padding: "4px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "var(--claude-text-secondary)",
                      }}
                    >
                      {task.isEditing ? <Check size={16} /> : <Edit3 size={16} />}
                    </button>
                    <button
                      onClick={() => removeTask(task.agentId)}
                      style={{
                        padding: "4px",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#ef4444",
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Task Message */}
                {task.isEditing ? (
                  <textarea
                    value={task.message}
                    onChange={(e) => updateTask(task.agentId, { message: e.target.value })}
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
                ) : (
                  <p
                    style={{
                      margin: 0,
                      fontSize: "13px",
                      color: "var(--claude-text-secondary)",
                      lineHeight: 1.5,
                    }}
                  >
                    {task.message}
                  </p>
                )}

                {/* Reasoning */}
                {task.reasoning && (
                  <div
                    style={{
                      marginTop: "8px",
                      fontSize: "11px",
                      color: "var(--claude-text-tertiary)",
                      fontStyle: "italic",
                    }}
                  >
                    {task.reasoning}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Execute Button */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
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
            {isSubmitting ? "Creating Queue..." : "Execute Queue"}
          </button>
        </div>
      )}
    </div>
  );
}
