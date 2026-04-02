#!/usr/bin/env bash

# === MODEL SELECTION (edit this to switch models) ===
LLM_PROVIDER="gemma"   # Options: gemma | qwen

case "$LLM_PROVIDER" in
  gemma) LLM_CUSTOM_NAME="gemma4-silent" ;;
  qwen)  LLM_CUSTOM_NAME="qwen3-silent"  ;;
  *)
    echo "ERROR: Unknown LLM_PROVIDER '$LLM_PROVIDER'. Use 'gemma' or 'qwen'."
    exit 1
    ;;
esac

# Check what's running inside ollama (don't worry if nothing is shown, Stuff gets loaded on 
# demand when you run `ollama run` or `ollama chat` commands, so it's normal for nothing to be 
# running until you do that)
ollama ps

# Query model info about the currently selected custom model
ollama show "$LLM_CUSTOM_NAME" --modelfile

# TIP: Run this to monitor CPU use during inference
#     watch -n 1 "grep 'cpu MHz' /proc/cpuinfo"

# To monitor GPU status
#     sudo apt install intel-gpu-tools
#     sudo intel_gpu_top

# To monitor temperature:
#    sudo apt install btop
#    btop