<#
.SYNOPSIS
    Neutralises spreadsheet formula injection in exported cell values.
.DESCRIPTION
    Assessment exports carry tenant-controlled text (group, app, policy and inbox
    rule names). Any tenant user who can name an object can therefore place a
    string such as '=HYPERLINK(...)' into a workbook or CSV that a consultant or
    customer later opens. These helpers prefix an apostrophe to values that a
    spreadsheet application would otherwise evaluate, which forces them to be
    treated as text.

    Two modes exist because the two file formats differ:
      - CSV: the spreadsheet application decides at open time, so every leading
        '=', '+', '-', '@', tab and carriage return is neutralised (OWASP CSV
        injection guidance).
      - XLSX (-FormulaLeadOnly): cells are typed when written. The ImportExcel
        module only promotes strings starting with '=' to formulas, so only
        that lead character is neutralised and values such as '-1' or
        '+1 555 0100' stay readable.
.NOTES
    Dot-source from any exporter:
        . (Join-Path -Path $PSScriptRoot -ChildPath 'ConvertTo-SafeCellValue.ps1')
#>

function ConvertTo-SafeCellValue {
    <#
    .SYNOPSIS
        Returns a string that a spreadsheet will not evaluate as a formula.
    .PARAMETER Value
        The cell text. Null and empty values are returned unchanged.
    .PARAMETER FormulaLeadOnly
        Only neutralise a leading '=' (XLSX mode).
    .EXAMPLE
        ConvertTo-SafeCellValue -Value '=HYPERLINK("https://example.test","x")'
        Returns the same text prefixed with an apostrophe.
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter(Mandatory)]
        [AllowNull()]
        [AllowEmptyString()]
        [string]$Value,

        [Parameter()]
        [switch]$FormulaLeadOnly
    )

    if ([string]::IsNullOrEmpty($Value)) { return $Value }

    $lead = $Value[0]
    $dangerous = if ($FormulaLeadOnly) {
        $lead -eq '='
    }
    else {
        $lead -eq '=' -or $lead -eq '+' -or $lead -eq '-' -or $lead -eq '@' -or
        $lead -eq [char]9 -or $lead -eq [char]13
    }

    if ($dangerous) { return "'" + $Value }
    return $Value
}

function ConvertTo-SafeCellObject {
    <#
    .SYNOPSIS
        Copies pipeline objects with every string property neutralised.
    .DESCRIPTION
        Emits a new PSCustomObject per input object, preserving property order.
        Non-string values (numbers, dates, booleans) pass through untouched so
        spreadsheet typing is unaffected.
    .PARAMETER InputObject
        The row object to copy.
    .PARAMETER FormulaLeadOnly
        Only neutralise a leading '=' (XLSX mode).
    .EXAMPLE
        $rows | ConvertTo-SafeCellObject -FormulaLeadOnly | Export-Excel -Path $path
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject])]
    param(
        [Parameter(Mandatory, ValueFromPipeline)]
        [AllowNull()]
        [object]$InputObject,

        [Parameter()]
        [switch]$FormulaLeadOnly
    )

    process {
        if ($null -eq $InputObject) { return }

        $copy = [ordered]@{}
        foreach ($property in $InputObject.PSObject.Properties) {
            $propertyValue = $property.Value
            if ($propertyValue -is [string]) {
                $copy[$property.Name] = ConvertTo-SafeCellValue -Value $propertyValue -FormulaLeadOnly:$FormulaLeadOnly
            }
            else {
                $copy[$property.Name] = $propertyValue
            }
        }
        [PSCustomObject]$copy
    }
}
