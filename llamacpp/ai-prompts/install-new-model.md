# Objective: Setup new Qwen Model

Instructions to Coding Agent for refactoring our llamacpp setup.

if you look in the folder named `llamacpp` in this project, you'll find the files related to how we install and run a local LLM that the MkBrowser can make use of for supporting its AI features. there's not too many files in that folder so please read all of them to get a full understanding of how things work. you'll notice that we've currently got `MODEL_FILE="gemma-4-26B-A4B-it-UD-IQ4_XS.gguf` line uncommented in the scripts and so that's what gets run by the `start-server.sh` script.

Qwen has just released a new better version, which I've put information about in folder `llamacpp/model-research/Qwen`, so read both of those files in that folder, and I would like for you to switch our bash scripts over to where we know use the **Qwen3.6-35B-A3B** (MoE) mentioned. 

be sure not to destroy our ability to revert back to the current model, because the way we should have our bash scripts set up, is that we should simply be able to comment out the old environment variables associated with the old model, and then define new environment variable setters that set the model values to where it will download the new model that we want. you can probably just follow the examples in the script because we're already doing this type of thing where we can easily switch from one model to another simply by uncommenting specific environment variable setters in our bash scripts.

so please update my scripts and then let me know what I need to run in order to get `start-server.sh` to begin serving up the new **Qwen3.6-35B-A3B** model.
