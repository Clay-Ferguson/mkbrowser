# Ollama Setup for MkBrowser

Local LLM integration using [Ollama](https://ollama.com) with the **Qwen3 4B** model.

- [Ollama Website](https://ollama.com)
- [Ollama GitHub](https://github.com/ollama/ollama)
- [Qwen3 on Ollama](https://ollama.com/library/qwen3)
- [Qwen3 on Hugging Face](https://huggingface.co/Qwen/Qwen3-4B)

## Installation Steps

Run these two scripts in order from the `ollama/` directory:

```bash
# 1. Install Ollama, pull the base model, and run smoke tests
./setup.sh

# 2. Create the custom 'qwen3-silent' model with thermal/noise tuning
./configure.sh
```

After both scripts complete, MkBrowser's AI features will use the `qwen3-silent` model automatically.

## Scripts Reference

| Script | Purpose |
|--------|---------|
| `setup.sh` | Installs Ollama (if not already installed), starts the server, pulls the `qwen3:4b` base model (~2.5 GB download), and runs smoke tests against both the `/api/generate` and `/api/chat` endpoints to verify everything works. |
| `configure.sh` | Creates a custom model called `qwen3-silent` from the `Modelfile`. This applies hardware-tuned parameters (4 threads, 16K context, capped response length) to keep the Lunar Lake laptop cool and quiet. Runs a quick test prompt to verify. |
| `status-check.sh` | Shows what models are currently loaded in memory (`ollama ps`) and dumps the full Modelfile configuration for `qwen3-silent`. Also includes tips for monitoring CPU, GPU, and temperature. |

## Modelfiles

| File | Base Model | Purpose |
|------|-----------|---------|
| `Modelfile` | `qwen3:4b` | Standard chat assistant with thermal tuning (1024 token response limit) |
| `Modelfile-for-Agents` | `qwen3:4b` | Agent/tool-calling variant with longer response limit (4096 tokens) to accommodate tool call round-trips |

## Manual Verification

After running the setup scripts, you can also test interactively:

```bash
# Interactive chat session (Ctrl+D or /bye to exit)
ollama run qwen3:4b

# Or use the custom tuned model
ollama run qwen3-silent

# Check server health
curl http://localhost:11434/api/version

# Check which models are loaded in memory
curl http://localhost:11434/api/ps
```

## How Other Apps Connect

The Ollama server exposes an OpenAI-compatible API. Any app (like MkBrowser via LangChain) connects via HTTP:

- **Base URL**: `http://localhost:11434`
- **Chat endpoint**: `POST /api/chat`
- **Model name**: `qwen3-silent` (or `qwen3:4b` for the untuned base)

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

# Pull a newer version of the model
ollama pull qwen3:4b

# Remove a model
ollama rm qwen3:4b

# See what models are currently running
ollama ps

# Stop/unload a model from memory
ollama stop qwen3:4b
```
