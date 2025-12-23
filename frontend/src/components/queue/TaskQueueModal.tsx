import { useState } from "react";
import { X, Wand2, ListPlus } from "lucide-react";
import type { Agent } from "../../hooks/useAgentConfig";
import type { TaskInput, TaskQueueSettings } from "../../../../shared/taskQueueTypes";
import { ManualAssignmentTab } from "./ManualAssignmentTab";
import { AIAutoSplitTab } from "./AIAutoSplitTab";

interface TaskQueueModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateQueue: (
    name: string,
    tasks: TaskInput[],
    settings?: Partial<TaskQueueSettings>
  ) => Promise<void>;
  agents: Agent[];
  orchestratorEndpoint?: string;
}

type TabType = "manual" | "ai";

export function TaskQueueModal({
  isOpen,
  onClose,
  onCreateQueue,
  agents,
  orchestratorEndpoint,
}: TaskQueueModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("manual");
  const [queueName, setQueueName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out orchestrator from available agents
  const workerAgents = agents.filter((a) => !a.isOrchestrator);

  const handleCreate = async (tasks: TaskInput[]) => {
    if (!queueName.trim()) {
      setError("Please enter a queue name");
      return;
    }

    if (tasks.length === 0) {
      setError("Please add at least one task");
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      await onCreateQueue(queueName.trim(), tasks);
      // Reset and close
      setQueueName("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create queue");
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--claude-message-bg)",
          border: "1px solid var(--claude-border)",
          borderRadius: "12px",
          padding: "24px",
          width: "700px",
          maxWidth: "95vw",
          maxHeight: "85vh",
          overflowY: "auto",
          boxShadow: "var(--claude-shadow)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "20px",
          }}
        >
          <h2
            style={{
              fontSize: "18px",
              fontWeight: 600,
              margin: 0,
              color: "var(--claude-text-primary)",
            }}
          >
            Create Task Queue
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--claude-text-secondary)",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Queue Name */}
        <div style={{ marginBottom: "20px" }}>
          <label
            style={{
              display: "block",
              fontSize: "13px",
              fontWeight: 500,
              marginBottom: "6px",
              color: "var(--claude-text-primary)",
            }}
          >
            Queue Name
          </label>
          <input
            type="text"
            value={queueName}
            onChange={(e) => setQueueName(e.target.value)}
            placeholder="e.g., Feature Implementation"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid var(--claude-border)",
              background: "var(--claude-bg)",
              color: "var(--claude-text-primary)",
              fontSize: "14px",
              outline: "none",
            }}
          />
        </div>

        {/* Tab Selector */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            marginBottom: "20px",
            borderBottom: "1px solid var(--claude-border)",
            paddingBottom: "12px",
          }}
        >
          <button
            onClick={() => setActiveTab("manual")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background:
                activeTab === "manual"
                  ? "var(--claude-accent)"
                  : "transparent",
              color:
                activeTab === "manual"
                  ? "white"
                  : "var(--claude-text-secondary)",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            <ListPlus size={16} />
            Manual Assignment
          </button>
          <button
            onClick={() => setActiveTab("ai")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "8px 16px",
              borderRadius: "6px",
              border: "none",
              background:
                activeTab === "ai" ? "var(--claude-accent)" : "transparent",
              color:
                activeTab === "ai" ? "white" : "var(--claude-text-secondary)",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 500,
            }}
          >
            <Wand2 size={16} />
            AI Auto-Split
          </button>
        </div>

        {/* Error Display */}
        {error && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
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

        {/* Tab Content */}
        {activeTab === "manual" ? (
          <ManualAssignmentTab
            agents={workerAgents}
            onSubmit={handleCreate}
            isSubmitting={isCreating}
          />
        ) : (
          <AIAutoSplitTab
            agents={workerAgents}
            orchestratorEndpoint={orchestratorEndpoint}
            onSubmit={handleCreate}
            isSubmitting={isCreating}
          />
        )}
      </div>
    </div>
  );
}
