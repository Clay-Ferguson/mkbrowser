#!/usr/bin/env bash

# This script creates a 'silent' custom model from the appropriate Modelfile, tuned
# for thermal/noise and running with 4 threads.
#
# NOTE: the script is intended to be run after you've already gotten the `setup.sh` script working.
# It assumes you have Ollama installed and the server running, and it just configures the model and verifies it's working.

# === MODEL SELECTION (edit this to switch models) ===
LLM_PROVIDER="gemma"   # Options: gemma | qwen

case "$LLM_PROVIDER" in
  gemma)
    LLM_BASE_MODEL="gemma4:e2b"
    LLM_CUSTOM_NAME="gemma4-silent"
    LLM_MODELFILE="modelfiles/gemma/Modelfile"
    ;;
  qwen)
    LLM_BASE_MODEL="qwen3:4b"
    LLM_CUSTOM_NAME="qwen3-silent"
    LLM_MODELFILE="modelfiles/qwen/Modelfile"
    ;;
  *)
    echo "ERROR: Unknown LLM_PROVIDER '$LLM_PROVIDER'. Use 'gemma' or 'qwen'."
    exit 1
    ;;
esac

# 1. Create your custom silent version
# (Make sure you are in the same folder as your 'modelfiles/' directory)
ollama create "$LLM_CUSTOM_NAME" -f "$LLM_MODELFILE"

# 2. Run it to verify it works (this will also 'preload' it)
ollama run "$LLM_CUSTOM_NAME" "Quick test: are you running with 4 threads?"
