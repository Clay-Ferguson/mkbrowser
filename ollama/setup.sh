
#!/usr/bin/env bash
set -euo pipefail

# === MODEL SELECTION (edit this to switch models) ===
LLM_PROVIDER="gemma"   # Options: gemma | qwen

case "$LLM_PROVIDER" in
  gemma)
    LLM_BASE_MODEL="gemma4:e2b"
    LLM_CUSTOM_NAME="gemma4-silent"
    ;;
  qwen)
    LLM_BASE_MODEL="qwen3:4b"
    LLM_CUSTOM_NAME="qwen3-silent"
    ;;
  *)
    echo "ERROR: Unknown LLM_PROVIDER '$LLM_PROVIDER'. Use 'gemma' or 'qwen'."
    exit 1
    ;;
esac

echo "=== 1. Install Ollama ==="
if command -v ollama &>/dev/null; then
    echo "Ollama is already installed: $(ollama --version)"
else
    curl -fsSL https://ollama.com/install.sh | sh
    echo "Ollama installed: $(ollama --version)"
fi

echo ""
echo "=== 2. Start Ollama server (if not already running) ==="
if curl -s http://localhost:11434/api/version &>/dev/null; then
    echo "Ollama server is already running."
else
    echo "Starting Ollama server in background..."
    ollama serve &>/dev/null &
    OLLAMA_PID=$!
    echo "Waiting for server to be ready..."
    for i in {1..30}; do
        if curl -s http://localhost:11434/api/version &>/dev/null; then
            echo "Server is ready."
            break
        fi
        sleep 1
    done
fi

echo ""
echo "=== 3. Pull model: $LLM_BASE_MODEL ==="
echo "This downloads the model on first run. Subsequent runs are instant."
ollama pull "$LLM_BASE_MODEL"

echo ""
echo "=== 4. Verify model is available ==="
echo "Installed models:"
ollama list

echo ""
echo "=== 5. Smoke test: send a prompt ==="
echo "Sending test prompt..."
RESPONSE=$(curl -s http://localhost:11434/api/generate \
    -d "{\"model\": \"$LLM_BASE_MODEL\", \"prompt\": \"Respond with exactly: Hello, I am running locally!\", \"stream\": false}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['response'])")

echo ""
echo "Model response:"
echo "---"
echo "$RESPONSE"
echo "---"

echo ""
echo "=== 6. Chat API test (OpenAI-compatible) ==="
echo "Testing the /api/chat endpoint (this is what LangChain ChatOllama uses)..."
CHAT_RESPONSE=$(curl -s http://localhost:11434/api/chat \
    -d "{\"model\": \"$LLM_BASE_MODEL\", \"messages\": [{\"role\": \"user\", \"content\": \"What is 2 + 2? Reply with just the number.\"}], \"stream\": false}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['content'])")

echo "Chat response: $CHAT_RESPONSE"

echo ""
echo "=== All done! ==="
echo "Your local LLM server is running at: http://localhost:11434"
echo ""
echo "Quick reference:"
echo "  ollama list                   # list installed models"
echo "  ollama run $LLM_BASE_MODEL    # interactive chat in terminal"
echo "  ollama stop $LLM_BASE_MODEL   # unload model from memory"
echo "  ollama serve                  # start server (usually auto-starts via systemd)"
echo "  systemctl status ollama       # check systemd service status"
echo "  journalctl -u ollama          # view server logs"
```

