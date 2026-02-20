# Local LLM Server (Ollama + Qwen 2.5 7B)

## Goal

Run a local LLM inference server using **Ollama** with the **Qwen 2.5 7B Instruct Q4_K_M** model. This server exposes an HTTP API on `http://localhost:11434` that other applications (e.g., an Electron app) can call via LangChain's `ChatOllama` or raw HTTP requests.

## Hardware

- **CPU**: Intel Core Ultra 9 288V (8 cores, Lunar Lake)
- **GPU**: Intel Arc iGPU (8 Xe2 cores) — Ollama uses Vulkan acceleration
- **RAM**: 32GB LPDDR5x unified memory
- **Model RAM footprint**: ~5.5 GB (leaves plenty of headroom)

## Setup Script

Run `chmod +x setup.sh && ./setup.sh`:
