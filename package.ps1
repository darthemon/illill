param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

$root = $PSScriptRoot
$manifestPath = Join-Path $root "manifest.json"
$version = "latest"

if (Test-Path -LiteralPath $manifestPath) {
    $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.version) {
        $version = [string]$manifest.version
    }
}

if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $root ("illill-v" + $version + ".zip")
} elseif (-not [System.IO.Path]::IsPathRooted($OutputPath)) {
    $OutputPath = Join-Path $root $OutputPath
}

if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath -Force
}

$excludeNames = @(
    ".gitignore",
    ".gitattributes",
    "package.ps1",
    ".DS_Store",
    "Thumbs.db",
    "desktop.ini"
)

$rootPrefix = $root.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
$allFiles = Get-ChildItem -Path $root -Recurse -File -Force
$includedFiles = New-Object System.Collections.Generic.List[object]

foreach ($file in $allFiles) {
    $relPath = $file.FullName.Substring($rootPrefix.Length)

    if ($relPath.StartsWith(".git\", [System.StringComparison]::OrdinalIgnoreCase) -or
        $relPath.StartsWith(".git/", [System.StringComparison]::OrdinalIgnoreCase)) {
        continue
    }

    $name = $file.Name
    if ($excludeNames -contains $name) {
        continue
    }
    if ($name.StartsWith("._", [System.StringComparison]::OrdinalIgnoreCase)) {
        continue
    }
    if ($name.EndsWith(".zip", [System.StringComparison]::OrdinalIgnoreCase)) {
        continue
    }

    $entryName = $relPath -replace '\\', '/'
    $includedFiles.Add([PSCustomObject]@{
        FullName  = $file.FullName
        EntryName = $entryName
    })
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$fs = New-Object System.IO.FileStream($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
    $archive = New-Object System.IO.Compression.ZipArchive($fs, [System.IO.Compression.ZipArchiveMode]::Create, $false, [System.Text.Encoding]::UTF8)
    try {
        foreach ($item in $includedFiles) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $item.FullName,
                $item.EntryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }
}
finally {
    $fs.Dispose()
}

Write-Output ("Created: " + $OutputPath)
Write-Output ("Included files: " + $includedFiles.Count)
foreach ($item in $includedFiles) {
    Write-Output (" - " + $item.EntryName)
}
