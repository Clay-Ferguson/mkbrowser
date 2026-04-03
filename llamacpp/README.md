# llama.cpp — Local LLM Backend

Run local LLM models using [llama.cpp](https://github.com/ggml-org/llama.cpp) as
an alternative to Ollama. llama.cpp provides an OpenAI-compatible HTTP API, which
MkBrowser connects to via the `LLAMACPP` provider.

## Quick Start

```bash
# 1. Install llama.cpp (downloads prebuilt binaries)
./setup.sh

# 2. Download the Gemma 4 E2B model (~3.1 GB)
./download-model.sh

# 3. Start the server
./start-server.sh
```

Then in MkBrowser **Settings → AI**:
- Select **Gemma 4 (llama.cpp)** as your model
- Verify the **llama.cpp Base URL** is `http://localhost:8080/v1`

## Prerequisites

- **Linux x86_64** (Ubuntu or similar)
- **32 GB RAM** recommended (the Gemma 4 E2B Q4_K_M model is ~3.1 GB)
- `curl`, `unzip`, `bc` (standard on most Ubuntu installs)

## Files

| Script | Purpose |
|--------|---------|
| `setup.sh` | Download and install llama.cpp binaries to `~/.local/bin/` |
| `download-model.sh` | Download a quantized Gemma 4 GGUF model to `~/.local/share/llama.cpp/models/` |
| `start-server.sh` | Launch `llama-server` on `localhost:8080` |

## Verifying the Server

Once `start-server.sh` is running, test with:

```bash
# List available models
curl http://localhost:8080/v1/models

# Send a test chat completion
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-4",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 100
  }'
```

## Customization

### Using a different model

Edit the `MODEL_REPO`, `MODEL_FILE`, and `MODEL_URL` variables in `download-model.sh`,
and update `MODEL_FILE` in `start-server.sh` to match.

### Server parameters

`start-server.sh` passes CLI flags directly to `llama-server`. You can override
settings on the command line:

```bash
./start-server.sh --port 9090 --ctx-size 8192 --threads 8
```

Common flags:
- `--port N` — HTTP port (default: 8080)
- `--ctx-size N` — Context window size in tokens (default: 16384)
- `--threads N` — CPU threads (default: auto-detect)
- `--n-gpu-layers N` — Offload layers to GPU (for CUDA/ROCm builds)

See `llama-server --help` for all options.
