$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$executable = Join-Path $root 'src-tauri\target\release\family-atlas-desktop.exe'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the release application first.' }
# Unicode escapes also work with Windows PowerShell 5 reading a UTF-8 file without BOM.
$title = -join (0x421,0x435,0x43c,0x435,0x439,0x43d,0x44b,0x439,0x20,0x430,0x442,0x43b,0x430,0x441 | ForEach-Object { [char]$_ })
$path = Join-Path ([Environment]::GetFolderPath('Desktop')) ($title + '.lnk')
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($path)
if ((Test-Path -LiteralPath $path) -and $shortcut.TargetPath -and ($shortcut.TargetPath -ne $executable)) {
  throw 'A shortcut with this name already points to another application. It was not overwritten.'
}
$shortcut.TargetPath = $executable
$shortcut.WorkingDirectory = $root
$shortcut.IconLocation = (Join-Path $root 'src-tauri\icons\icon.ico') + ',0'
$shortcut.Description = 'Family Atlas Desktop - offline Tauri application'
$shortcut.Save()
Write-Output $path
