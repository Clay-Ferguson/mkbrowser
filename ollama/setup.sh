
#!/usr/bin/env bash
set -euo pipefail

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
echo "=== 3. Pull model: qwen2.5:7b ==="
echo "This downloads ~4.7 GB on first run. Subsequent runs are instant."
ollama pull qwen2.5:7b

echo ""
echo "=== 4. Verify model is available ==="
echo "Installed models:"
ollama list

echo ""
echo "=== 5. Smoke test: send a prompt ==="
echo "Sending test prompt..."
RESPONSE=$(curl -s http://localhost:11434/api/generate \
    -d '{
        "model": "qwen2.5:7b",
        "prompt": "Respond with exactly: Hello, I am running locally!",
        "stream": false
    }' | python3 -c "import sys,json; print(json.load(sys.stdin)['response'])")

echo ""
echo "Model response:"
echo "---"
echo "$RESPONSE"
echo "---"

echo ""
echo "=== 6. Chat API test (OpenAI-compatible) ==="
echo "Testing the /api/chat endpoint (this is what LangChain ChatOllama uses)..."
CHAT_RESPONSE=$(curl -s http://localhost:11434/api/chat \
    -d '{
        "model": "qwen2.5:7b",
        "messages": [{"role": "user", "content": "What is 2 + 2? Reply with just the number."}],
        "stream": false
    }' | python3 -c "import sys,json; print(json.load(sys.stdin)['message']['content'])")

echo "Chat response: $CHAT_RESPONSE"

echo ""
echo "=== All done! ==="
echo "Your local LLM server is running at: http://localhost:11434"
echo ""
echo "Quick reference:"
echo "  ollama list              # list installed models"
echo "  ollama run qwen2.5:7b    # interactive chat in terminal"
echo "  ollama stop qwen2.5:7b   # unload model from memory"
echo "  ollama serve             # start server (usually auto-starts via systemd)"
echo "  systemctl status ollama  # check systemd service status"
echo "  journalctl -u ollama     # view server logs"
```

## Manual Verification

After running the setup script, you can also test interactively:

```bash
# Interactive chat session (Ctrl+D or /bye to exit)
ollama run qwen2.5:7b

# Check server health
curl http://localhost:11434/api/version

# Check which models are loaded in memory
curl http://localhost:11434/api/ps
```

## How Other Apps Connect

The Ollama server exposes an OpenAI-compatible API. Any app (like an Electron app using LangChain) connects via HTTP:

- **Base URL**: `http://localhost:11434`
- **Chat endpoint**: `POST /api/chat`
- **Model name**: `qwen2.5:7b`

If the server isn't running, HTTP requests will fail with a connection refused error — which is the expected behavior.

## Service Management

Ollama's installer typically sets up a **systemd service** that auto-starts on boot:

```bash
# Check if running
systemctl status ollama

# Stop the server
sudo systemctl stop ollama

# Disable auto-start on boot
sudo systemctl disable ollama

# Re-enable auto-start
sudo systemctl enable ollama
```

## Upgrading or Adding Models Later

```bash
# Update Ollama itself
curl -fsSL https://ollama.com/install.sh | sh

# Pull a larger model if you want better quality
ollama pull qwen2.5:14b

# Pull a tiny model for fast iteration
ollama pull phi3.5:3.8b

# Remove a model
ollama rm qwen2.5:7b

# =========================================================
# NOTES: 
# To see what models are currently running:
#    ollama ps
# To stop a model:
#    ollama stop qwen2.5:7b
#
# =========================================================
