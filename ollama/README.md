# Ollama Setup for MkBrowser

Local LLM integration using [Ollama](https://ollama.com). Two models are supported and can be switched by editing one variable in each script.

| Provider | Base Model | Size | Ollama Library |
|----------|-----------|------|----------------|
| **gemma** (default) | `gemma4:e2b` | ~7.2 GB | [ollama.com/library/gemma4](https://ollama.com/library/gemma4) |
| **qwen** | `qwen3:4b` | ~2.5 GB | [ollama.com/library/qwen3](https://ollama.com/library/qwen3) |

## Switching Models

All three scripts (`setup.sh`, `configure.sh`, `status-check.sh`) have a `LLM_PROVIDER` variable near the top. Set it to `gemma` or `qwen`:

```bash
# === MODEL SELECTION (edit this to switch models) ===
LLM_PROVIDER="gemma"   # Options: gemma | qwen
```

Change this one line in each script before running, and the rest of the script automatically uses the correct base model, custom model name, and Modelfile path.

## Installation Steps

Run these two scripts in order from the `ollama/` directory:

```bash
# 1. Install Ollama, pull the base model, and run smoke tests
./setup.sh

# 2. Create the thermal-tuned custom model (e.g. 'gemma4-silent')
./configure.sh
```

After both scripts complete, MkBrowser's AI features will use the custom model automatically (e.g. `gemma4-silent` or `qwen3-silent`).

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
# Interactive chat with the base model
ollama run gemma4:e2b

# Or use the thermal-tuned custom model
ollama run gemma4-silent

# Check server health
curl http://localhost:11434/api/version

# Check which models are loaded in memory
curl http://localhost:11434/api/ps
```

## How Other Apps Connect

The Ollama server exposes an OpenAI-compatible API. Any app (like MkBrowser via LangChain) connects via HTTP:

- **Base URL**: `http://localhost:11434`
- **Chat endpoint**: `POST /api/chat`
- **Model name**: `gemma4-silent` or `qwen3-silent` (the thermal-tuned custom models)

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
./setup.sh

# Remove a model
ollama rm gemma4:e2b

# See what models are currently running
ollama ps

# Stop/unload a model from memory
ollama stop gemma4:e2b
```
