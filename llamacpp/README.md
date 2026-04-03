# llama.cpp — Local LLM Backend

Run local LLM models using [llama.cpp](https://github.com/ggml-org/llama.cpp) as
an alternative to Ollama. llama.cpp provides an OpenAI-compatible HTTP API, which
MkBrowser connects to via the `LLAMACPP` provider.

## Quick Start

```bash
# 1. Install llama.cpp (downloads prebuilt binaries)
./setup.sh

# 2. Download the Gemma 4 model (see model selection in script)
./download-model.sh

# 3. Start the server
./start-server.sh
```

Then in MkBrowser **Settings → AI**:
- Select **Gemma 4 (llama.cpp)** as your model
- Verify the **llama.cpp Base URL** is `http://localhost:8080/v1`

## Prerequisites

- **Linux x86_64** (Ubuntu or similar)
- **32 GB RAM** recommended (model sizes range from ~3.1 GB to ~13.4 GB)
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

## Switching Models

Three Gemma 4 model variants are supported:

| Variant | Params | Quant | File Size | Context | Notes |
|---------|--------|-------|-----------|---------|-------|
| **26B-A4B** | 3.8B active / 25.2B total (MoE) | UD-IQ4_XS | ~13.4 GB | 8192 | Highest quality, default |
| **E4B** | 4.5B effective (8B total) | Q4_K_M | ~5.0 GB | 16384 | Good balance |
| **E2B** | 2.3B effective (5.1B total) | Q4_K_M | ~3.1 GB | 16384 | Lightest, fastest |

To switch variants, edit the model selection block near the top of **both**
`download-model.sh` and `start-server.sh`. Comment out the active group and
uncomment the other:

```bash
# Uncomment ONE group of settings below.

# Gemma 4 E2B: 2.3B effective params (~3.1 GB)
MODEL_FILE="gemma-4-E2B-it-Q4_K_M.gguf"         # ← active
CTX_SIZE="16384"                                  # ← active

# Gemma 4 E4B: 4.5B effective params (~5.0 GB)
#MODEL_FILE="gemma-4-E4B-it-Q4_K_M.gguf"         # ← inactive
#CTX_SIZE="16384"                                  # ← inactive

# Gemma 4 26B-A4B (MoE): 3.8B active params (~13.4 GB)
#MODEL_FILE="gemma-4-26B-A4B-it-UD-IQ4_XS.gguf"  # ← inactive
#CTX_SIZE="8192"                                   # ← inactive
```

All model files can coexist on disk (they have different filenames), so you
only need to run `./download-model.sh` once per variant. After switching, just
restart `./start-server.sh`.

> **Note:** The 26B-A4B model uses a reduced context size (8192) to fit
> comfortably in 32 GB RAM alongside OS and KV cache overhead.

## Customization

### Server parameters

`start-server.sh` passes CLI flags directly to `llama-server`. You can override
settings on the command line:

```bash
./start-server.sh --port 9090 --ctx-size 8192 --threads 8
```

Common flags:
- `--port N` — HTTP port (default: 8080)
- `--ctx-size N` — Context window size in tokens (default: varies by model)
- `--threads N` — CPU threads (default: auto-detect)
- `--n-gpu-layers N` — Offload layers to GPU (for CUDA/ROCm builds)

See `llama-server --help` for all options.
