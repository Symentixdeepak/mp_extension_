# Selective console log cleanup - keeps console.error in catch blocks
# Usage: Run this in PowerShell from the extension root directory

Write-Host "🧹 Starting selective console log cleanup..." -ForegroundColor Green

$jsFiles = Get-ChildItem -Path "src" -Filter "*.js" -Recurse
$totalFiles = $jsFiles.Count
$filesModified = 0
$totalLinesRemoved = 0

Write-Host "📁 Found $totalFiles JavaScript files" -ForegroundColor Blue

foreach ($file in $jsFiles) {
    $content = Get-Content $file.FullName -Raw
    $originalContent = $content
    
    # Remove console.log statements
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.log\([^;]*(?:\([^)]*\)[^;]*)*\);\s*$', ''
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.log\([^;]*(?:\([^)]*\)[^;]*)*\)\s*$', ''
    
    # Remove console.warn statements  
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.warn\([^;]*(?:\([^)]*\)[^;]*)*\);\s*$', ''
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.warn\([^;]*(?:\([^)]*\)[^;]*)*\)\s*$', ''
    
    # Remove console.debug statements
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.debug\([^;]*(?:\([^)]*\)[^;]*)*\);\s*$', ''
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.debug\([^;]*(?:\([^)]*\)[^;]*)*\)\s*$', ''
    
    # Remove console.info statements
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.info\([^;]*(?:\([^)]*\)[^;]*)*\);\s*$', ''
    $content = $content -replace '(?m)^\s*(?://\s*)?console\.info\([^;]*(?:\([^)]*\)[^;]*)*\)\s*$', ''
    
    # Keep console.error statements - they're useful for debugging production issues
    
    if ($originalContent -ne $content) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        $filesModified++
        
        $relativePath = $file.FullName -replace [regex]::Escape((Get-Location).Path + "\"), ""
        Write-Host "  ✅ $relativePath - Cleaned up (kept console.error)" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🎉 Selective console cleanup completed!" -ForegroundColor Green
Write-Host "📊 Files processed: $totalFiles, Files modified: $filesModified" -ForegroundColor Blue
Write-Host "ℹ️  console.error statements were preserved for production debugging" -ForegroundColor Cyan
