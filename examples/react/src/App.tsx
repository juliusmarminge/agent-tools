import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { api } from "../convex/_generated/api";

export function App() {
  const messages = useQuery(api.functions.list);
  const sendMessage = useMutation(api.functions.send);
  const clearMessages = useMutation(api.functions.clear);
  const [input, setInput] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ content: input });
    setInput("");
  };

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "0 auto" }}>
      <h1>Convex Local Backend Demo</h1>
      <p style={{ color: "#666" }}>Using convex-vite-plugin</p>

      <form onSubmit={handleSubmit} style={{ marginBottom: "1rem" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          style={{ padding: "0.5rem", width: "300px", marginRight: "0.5rem" }}
        />
        <button type="submit" style={{ padding: "0.5rem 1rem" }}>
          Send
        </button>
        <button
          type="button"
          onClick={() => clearMessages()}
          style={{ padding: "0.5rem 1rem", marginLeft: "0.5rem" }}
        >
          Clear All
        </button>
      </form>

      <div>
        <h2>Messages ({messages?.length ?? 0})</h2>
        {messages === undefined ? (
          <p>Loading...</p>
        ) : messages.length === 0 ? (
          <p style={{ color: "#999" }}>No messages yet. Send one!</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {messages.map((msg) => (
              <li
                key={msg._id}
                style={{
                  padding: "0.5rem",
                  borderBottom: "1px solid #eee",
                }}
              >
                {msg.content}
                <span style={{ color: "#999", fontSize: "0.8rem", marginLeft: "1rem" }}>
                  {new Date(msg.createdAt).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
