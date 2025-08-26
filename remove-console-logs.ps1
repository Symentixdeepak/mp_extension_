# PowerShell script to remove console statements from Chrome extension
# Usage: Run this in PowerShell from the extension root directory

Write-Host "🧹 Starting console log cleanup..." -ForegroundColor Green

# Get all JavaScript files in src directory
$jsFiles = Get-ChildItem -Path "src" -Filter "*.js" -Recurse

$totalFiles = $jsFiles.Count
$filesModified = 0
$totalLinesRemoved = 0

Write-Host "📁 Found $totalFiles JavaScript files" -ForegroundColor Blue

foreach ($file in $jsFiles) {
    $content = Get-Content $file.FullName -Raw
    $originalLineCount = ($content -split "`n").Length
    
    # Remove console statements (including multiline ones)
    # This regex handles:
    # - console.log(...), console.error(...), etc.
    # - Multiline console statements
    # - Commented console statements
    $newContent = $content -replace '(?m)^\s*(?://\s*)?console\.[a-zA-Z]+\([^;]*(?:\([^)]*\)[^;]*)*\);\s*$', ''
    
    # Handle console statements without semicolons at end of line
    $newContent = $newContent -replace '(?m)^\s*(?://\s*)?console\.[a-zA-Z]+\([^;]*(?:\([^)]*\)[^;]*)*\)\s*$', ''
    
    # Remove any resulting empty lines (optional - keeps formatting clean)
    $newContent = $newContent -replace '(?m)^\s*\r?\n', "`n"
    
    # Count lines removed
    $newLineCount = ($newContent -split "`n").Length
    $linesRemoved = $originalLineCount - $newLineCount
    
    if ($content -ne $newContent) {
        Set-Content -Path $file.FullName -Value $newContent -NoNewline
        $filesModified++
        $totalLinesRemoved += $linesRemoved
        
        $relativePath = $file.FullName -replace [regex]::Escape((Get-Location).Path + "\"), ""
        Write-Host "  ✅ $relativePath - Removed $linesRemoved lines" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "🎉 Console cleanup completed!" -ForegroundColor Green
Write-Host "📊 Summary:" -ForegroundColor Blue
Write-Host "  • Files processed: $totalFiles" -ForegroundColor White
Write-Host "  • Files modified: $filesModified" -ForegroundColor White
Write-Host "  • Total console lines removed: $totalLinesRemoved" -ForegroundColor White

Write-Host ""
Write-Host "⚠️  Important reminders:" -ForegroundColor Red
Write-Host "  • Test your extension thoroughly after cleanup" -ForegroundColor White
Write-Host "  • Some console.error statements in catch blocks might be intentionally kept" -ForegroundColor White
Write-Host "  • Consider keeping logger.js console statements if they're part of your logging system" -ForegroundColor White

Write-Host ""
Write-Host "🚀 Your extension is now ready for Chrome Web Store submission!" -ForegroundColor Green
