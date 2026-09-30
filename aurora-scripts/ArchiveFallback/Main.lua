scriptTitle = "GODsend Archive Fallback"
scriptAuthor = "GODsend"
scriptVersion = 1
scriptDescription = "Fill missing game names, covers and icons from the XboxUnity archive"
scriptPermissions = { "http", "filesystem", "content", "sql" }

require("state")

local function clean(value)
    if type(value) ~= "string" then return "" end
    return value:gsub("[%z\1-\31\127]", ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function call(fn, ...)
    local ok, result = pcall(fn, ...)
    if ok then return result end
    return nil
end

local function auroraRoot()
    local base = clean(Script.GetBasePath()):gsub("/", "\\")
    local position = base:lower():find("\\user\\scripts\\utility\\", 1, true)
    if not position then return nil end
    return base:sub(1, position - 1)
end

local function missingName(name, titleId)
    local value = clean(name)
    local lower = value:lower()
    return value == "" or lower == titleId:lower() or
        lower == "unknown" or lower == "unknown title" or
        lower == "not available" or lower == "default.xex"
end

local function importImage(baseUrl, kind, titleId, importDirectory)
    local url = baseUrl .. "/webui/unity-archive/" .. kind .. "?title_id=" .. titleId
    local response = call(Http.Get, url, titleId .. "-" .. kind .. ".png")
    if not response or not response.Success or not response.OutputPath then return false end
    local destination = importDirectory .. "\\" .. kind .. ".png"
    local moved = call(FileSystem.MoveFile, response.OutputPath, destination, false)
    if moved ~= true then
        call(FileSystem.DeleteFile, response.OutputPath)
        return false
    end
    return true
end

function main()
    local root = auroraRoot()
    if not root then
        Script.ShowMessageBox("Archive Fallback", "Install this script under Aurora\\User\\Scripts\\Utility\\ArchiveFallback.", "OK")
        return
    end
    local host = clean(BRAIN_IP)
    if host == "" then
        Script.ShowMessageBox("Archive Fallback", "Configure BRAIN_IP in state.lua, or install this script from GODsend Server settings.", "OK")
        return
    end
    local baseUrl = "http://" .. host .. ":" .. clean(PORT)
    local rows = call(Sql.ExecuteFetchRows, "SELECT Id, TitleId, TitleName FROM ContentItems ORDER BY Id")
    if type(rows) ~= "table" then
        Script.ShowMessageBox("Archive Fallback", "Could not read the Aurora game database.", "OK")
        return
    end
    local confirmed = Script.ShowMessageBox("Archive Fallback", "Check " .. tostring(#rows) .. " games for missing names and artwork? Existing names and artwork will be kept.", "Start", "Cancel")
    if not confirmed or confirmed.Button ~= 1 then return end

    local renamed, covers, icons, errors = 0, 0, 0, 0
    local importRoot = root .. "\\User\\Import"
    for index, row in ipairs(rows) do
        if Script.IsCanceled() then break end
        local contentId = tonumber(row.Id)
        local titleNumber = tonumber(row.TitleId)
        if contentId and titleNumber then
            local titleId = string.format("%08X", titleNumber % 4294967296)
            local contentHex = string.format("%08X", contentId % 4294967296)
            local gameData = root .. "\\Data\\GameData\\" .. titleId .. "_" .. contentHex
            local needsName = missingName(row.TitleName, titleId)
            local needsCover = not FileSystem.FileExists(gameData .. "\\GC" .. titleId .. ".asset")
            local needsIcon = not FileSystem.FileExists(gameData .. "\\GL" .. titleId .. ".asset")
            if needsName or needsCover or needsIcon then
                Script.SetStatus("Checking " .. titleId .. " (" .. index .. "/" .. #rows .. ")")
                local titleResponse = call(Http.Get, baseUrl .. "/webui/unity-archive/title?title_id=" .. titleId)
                if titleResponse and titleResponse.Success then
                    local title = clean(titleResponse.OutputData)
                    if needsName and title ~= "" then
                        if call(Content.SetTitle, contentId, title) == true then renamed = renamed + 1 else errors = errors + 1 end
                    end
                    if needsCover or needsIcon then
                        local importDirectory = importRoot .. "\\" .. titleId
                        call(FileSystem.CreateDirectory, importRoot)
                        call(FileSystem.CreateDirectory, importDirectory)
                        if needsCover and not FileSystem.FileExists(importDirectory .. "\\cover.png") then
                            if importImage(baseUrl, "cover", titleId, importDirectory) then covers = covers + 1 else errors = errors + 1 end
                        end
                        if needsIcon and not FileSystem.FileExists(importDirectory .. "\\icon.png") then
                            if importImage(baseUrl, "icon", titleId, importDirectory) then icons = icons + 1 else errors = errors + 1 end
                        end
                    end
                else
                    errors = errors + 1
                end
            end
        end
        Script.SetProgress(math.floor(index * 100 / math.max(#rows, 1)))
    end
    Script.SetRefreshListOnExit(true)
    Script.ShowMessageBox("Archive Fallback", "Names updated: " .. renamed .. "\nCovers staged: " .. covers .. "\nIcons staged: " .. icons .. "\nErrors or unavailable titles: " .. errors .. "\n\nTo install staged images: Aurora Settings > Assets > Import.", "OK")
end
