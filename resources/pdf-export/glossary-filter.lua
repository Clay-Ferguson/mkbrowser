-- Glossary Filter for Pandoc
-- Automatically replaces {Term} with [Term](#term) links
-- Reads glossary terms from Glossary_of_Terms.md

local glossary = {}

-- Convert a term to a Pandoc-style anchor (lowercase, spaces to hyphens)
local function to_anchor(term)
    return "#" .. term:lower():gsub("%s+", "-")
end

-- Parse the glossary file to extract heading terms
local function load_glossary()
    -- Find the glossary file (handles ordinal prefixes like 00236_Glossary_of_Terms.md)
    local glossary_path = nil
    
    -- Use ls and pattern matching to find the file
    local handle = io.popen('ls -1 *Glossary_of_Terms.md 2>/dev/null')
    if handle then
        glossary_path = handle:read("*l")  -- Read first matching line
        handle:close()
    end
    
    if not glossary_path then
        io.stderr:write("Warning: Could not find *Glossary_of_Terms.md\n")
        return
    end
    
    local file = io.open(glossary_path, "r")
    if not file then
        io.stderr:write("Warning: Could not open " .. glossary_path .. "\n")
        return
    end
    
    for line in file:lines() do
        -- Match lines that start with # (heading level 1)
        local term = line:match("^#%s+(.+)%s*$")
        if term then
            -- Trim whitespace
            term = term:gsub("^%s*(.-)%s*$", "%1")
            glossary[term] = {
                display = term,
                anchor = to_anchor(term)
            }
        end
    end
    
    file:close()
end

-- Load glossary when filter starts
load_glossary()

-- Process inline elements to handle terms like {Term}
-- Handles single-word and multi-word terms, even with surrounding punctuation
function Inlines(inlines)
    local result = {}
    local i = 1
    
    while i <= #inlines do
        local elem = inlines[i]
        local processed = false
        
        -- Check if this element is a Str and contains '{'
        if elem.t == "Str" and elem.text:find("{") then
            local text = elem.text
            local start_idx = text:find("{")
            
            -- We found a starting brace. Now we need to find the matching closing brace.
            -- It could be in the same Str, or in subsequent Inlines.
            
            local collected_text = ""
            local found_end = false
            local end_idx = nil
            local j = i
            local suffix_text = ""
            
            -- Check if closing brace is in the current string AFTER the opening brace
            local current_rest = text:sub(start_idx)
            local close_in_current = current_rest:find("}")
            
            if close_in_current then
                -- Case 1: {Term} is entirely within this Str
                end_idx = start_idx + close_in_current - 1
                collected_text = text:sub(start_idx, end_idx)
                found_end = true
                suffix_text = text:sub(end_idx + 1)
            else
                -- Case 2: {Term starts here but ends later
                collected_text = current_rest
                j = j + 1
                
                while j <= #inlines do
                    local next_elem = inlines[j]
                    if next_elem.t == "Str" then
                        local close_pos = next_elem.text:find("}")
                        if close_pos then
                            collected_text = collected_text .. next_elem.text:sub(1, close_pos)
                            suffix_text = next_elem.text:sub(close_pos + 1)
                            found_end = true
                            break
                        else
                            collected_text = collected_text .. next_elem.text
                        end
                    elseif next_elem.t == "Space" then
                        collected_text = collected_text .. " "
                    else
                        -- Formatting or other elements break the term
                        break 
                    end
                    j = j + 1
                end
            end
            
            if found_end then
                local term_content = collected_text:match("^{(.+)}$")
                if term_content and glossary[term_content] then
                    -- We have a match!
                    processed = true
                    
                    -- 1. Add prefix (if any)
                    local prefix = text:sub(1, start_idx - 1)
                    if prefix ~= "" then
                        table.insert(result, pandoc.Str(prefix))
                    end
                    
                    -- 2. Add Link
                    table.insert(result, pandoc.Link(glossary[term_content].display, glossary[term_content].anchor))
                    
                    -- 3. Handle suffix recursively
                    if suffix_text ~= "" then
                        local suffix_inlines = Inlines({pandoc.Str(suffix_text)})
                        for _, v in ipairs(suffix_inlines) do
                            table.insert(result, v)
                        end
                    end
                    
                    -- Advance loop index
                    i = j + 1
                end
            end
        end
        
        if not processed then
            table.insert(result, elem)
            i = i + 1
        end
    end
    
    return pandoc.Inlines(result)
end
