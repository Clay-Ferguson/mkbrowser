#!/usr/bin/env bash

# This script creates a more 'custom' version of the qwen3:4b model (named qwen3-silent) that runs silently 
# with 4 threads, and verifies it's working.
#
# NOTE: the script is intended to be run after you've already gotten the `setup.sh` script working. 
# It assumes you have Ollama installed and the server running, and it just configures the model and verifies it's working.


# 1. Create your custom silent version
# (Make sure you are in the same folder as your 'Modelfile')
ollama create qwen3-silent -f Modelfile

# 2. Run it to verify it works (this will also 'preload' it)
ollama run qwen3-silent "Quick test: are you running with 4 threads?"
