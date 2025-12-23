import { MessageCircle, Users, Settings, ListTodo, Lock } from "lucide-react";
import { useState } from "react";
import { useAgentConfig } from "../../hooks/useAgentConfig";
import { SettingsModal } from "../SettingsModal";
import { AuthButton } from "../auth/AuthButton";

interface SidebarProps {
  activeAgentId: string | null;
  agentSessions: Record<string, { sessionId: string | null; messages: any[] }>;
  onAgentSelect: (agentId: string) => void;
  onNewAgentRoom: () => void;
  currentMode: "group" | "agent" | "queue";
  onModeChange: (mode: "group" | "agent" | "queue") => void;
  onShowQueue?: () => void;
  queueProgress?: { completed: number; total: number } | null;
  busyAgentIds?: Set<string>;
}

const getAgentColor = (agentId: string) => {
  // Map agent IDs to CSS color variables, with fallback
  const colorMap: Record<string, string> = {
    "readymojo-admin": "var(--agent-admin)",
    "readymojo-api": "var(--agent-api)", 
    "readymojo-web": "var(--agent-web)",
    "peakmojo-kit": "var(--agent-kit)",
  };
  return colorMap[agentId] || "var(--claude-text-accent)";
};

export function Sidebar({
  activeAgentId,
  agentSessions,
  onAgentSelect,
  onNewAgentRoom,
  currentMode,
  onModeChange,
  onShowQueue,
  queueProgress,
  busyAgentIds = new Set(),
}: SidebarProps) {
  const [showSettings, setShowSettings] = useState(false);
  const { getWorkerAgents } = useAgentConfig();
  const agents = getWorkerAgents();

  return (
    <div className="layout-sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <MessageCircle size={14} />
          </div>
          <div className="sidebar-brand-text">
            <h1>Agentrooms</h1>
            <p>Multi-Agent Workspace</p>
          </div>
        </div>

        {/* Agent Room Button */}
        <button
          onClick={() => {
            onNewAgentRoom();
            onModeChange("group");
          }}
          className={`sidebar-button ${currentMode === "group" ? "active" : ""}`}
        >
          <Users className="sidebar-button-icon" />
          Agent Room
          {currentMode === "group" && <span className="sidebar-button-badge">•</span>}
        </button>

        {/* Task Queue Button */}
        <button
          onClick={() => {
            onShowQueue?.();
            onModeChange("queue");
          }}
          className={`sidebar-button ${currentMode === "queue" ? "active" : ""}`}
        >
          <ListTodo className="sidebar-button-icon" />
          Task Queue
          {queueProgress && (
            <span className="sidebar-queue-badge">
              {queueProgress.completed}/{queueProgress.total}
            </span>
          )}
        </button>
      </div>

      {/* Agents Section */}
      <div className="sidebar-section">
        <div className="sidebar-section-title">Agents</div>
      </div>
      
      <div className="sidebar-agent-list">
        {agents.map((agent) => {
          const isActive = activeAgentId === agent.id && currentMode === "agent";
          const hasMessages = agentSessions[agent.id]?.messages.length > 0;
          const messageCount = agentSessions[agent.id]?.messages.length || 0;
          const isBusy = busyAgentIds.has(agent.id);

          return (
            <div
              key={agent.id}
              onClick={() => {
                onAgentSelect(agent.id);
                onModeChange("agent");
              }}
              className={`sidebar-agent-item ${isActive ? "active" : ""} ${isBusy ? "busy" : ""}`}
            >
              {/* Agent Indicator */}
              <div
                className="sidebar-agent-dot"
                style={{
                  backgroundColor: isBusy ? "#f59e0b" : getAgentColor(agent.id),
                  animation: isBusy ? "pulse 1.5s ease-in-out infinite" : undefined,
                }}
              />

              {/* Agent Info */}
              <div className="sidebar-agent-info">
                <div className="sidebar-agent-name">
                  {agent.name}
                  {isBusy && (
                    <Lock
                      size={12}
                      style={{
                        marginLeft: "6px",
                        color: "#f59e0b",
                        verticalAlign: "middle",
                      }}
                    />
                  )}
                </div>
                <div className="sidebar-agent-desc">
                  {isBusy ? "Working on queue task..." : agent.description}
                </div>
              </div>

              {/* Message Count */}
              {hasMessages && !isBusy && (
                <div className="sidebar-agent-count">{messageCount}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="sidebar-header" style={{ borderTop: "1px solid var(--claude-border)", borderBottom: "none" }}>
        {/* Authentication Section */}
        <AuthButton />
        
        {/* Settings Button */}
        <button 
          className="sidebar-button"
          onClick={() => setShowSettings(true)}
        >
          <Settings className="sidebar-button-icon" />
          Settings
        </button>
      </div>

      {/* Settings Modal */}
      <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />
    </div>
  );
}