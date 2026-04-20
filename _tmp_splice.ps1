$reportPath = "C:\git\M365-Assess\docs\sample-report\_Example-Report.html"
$themesPath = "C:\git\M365-Assess\src\M365-Assess\assets\report-themes.css"
$cssPath    = "C:\git\M365-Assess\src\M365-Assess\assets\report-shell.css"
$jsPath     = "C:\git\M365-Assess\src\M365-Assess\assets\report-app.js"

$html   = [System.IO.File]::ReadAllText($reportPath, [System.Text.Encoding]::UTF8)
$themes = [System.IO.File]::ReadAllText($themesPath, [System.Text.Encoding]::UTF8)
$css    = [System.IO.File]::ReadAllText($cssPath,    [System.Text.Encoding]::UTF8)
$js     = [System.IO.File]::ReadAllText($jsPath,     [System.Text.Encoding]::UTF8)

# Replace CSS block — themes first, then shell (same order as Get-ReportTemplate.ps1)
$combined = "$themes`n$css"
$html = [regex]::Replace($html, '(?s)(<style>).*?(</style>)', "`$1`n$combined`n`$2")

# Replace the report-app.js script block (last <script> before </body>)
$html = [regex]::Replace($html, '(?s)(<script>)\s*/\* global React, ReactDOM \*/.*?(</script>\s*</body>\s*</html>)', "<script>`n$js`n`$2")

[System.IO.File]::WriteAllText($reportPath, $html, [System.Text.Encoding]::UTF8)
Write-Host "Sample report spliced OK."
