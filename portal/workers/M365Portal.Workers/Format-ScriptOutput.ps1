# Format-ScriptOutput.ps1
# EPIC-007 SPEC.md §3.3, §5, §11.5 — custom-script output rendering. T-0128.
#
# v1 renders script output through the version's markdown template only
# (structured blocks are deferred). The template is plain markdown with tokens:
#
#   {{ Field }}            value of Field on the output object
#   {{ Field.Nested }}     dotted path into nested objects
#   {{ Count }}            element count when the output is a collection
#   {{#each Items}}
#   - {{ Name }}           repeats the block once per element, scoped to it
#   {{/each}}
#
# A token that cannot be resolved renders an explicit placeholder
# (`_(missing: Field)_`) rather than throwing, so a template error never hides
# the script's real output.
#
# Get-ScriptOutputStructure describes the output object's shape for the
# "Explore data structure" affordance (SPEC §3.3).

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:DefaultMissingPlaceholder = '_(missing: {0})_'
$script:ScriptOutputMaxDepth = 6

function Get-ScriptOutputProperty {
    <#
    .SYNOPSIS
        Reads a property without throwing under Set-StrictMode -Version Latest.
    #>
    [CmdletBinding()]
    param(
        [Parameter()][object]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.Contains($Name)) { return $Object[$Name] }
        return $null
    }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -ne $property) { return $property.Value }
    return $null
}

function Test-ScriptOutputProperty {
    param(
        [Parameter()][object]$Object,
        [Parameter(Mandatory)][string]$Name
    )
    if ($null -eq $Object) { return $false }
    if ($Object -is [System.Collections.IDictionary]) { return $Object.Contains($Name) }
    return $null -ne $Object.PSObject.Properties[$Name]
}

function Get-ScriptOutputTypeName {
    param([Parameter()][object]$Value)
    if ($null -eq $Value) { return 'null' }
    if ($Value -is [System.Collections.IDictionary]) { return 'object' }
    if ($Value -is [string]) { return 'string' }
    if ($Value -is [bool]) { return 'boolean' }
    if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) { return 'number' }
    if ($Value -is [System.Collections.IEnumerable]) { return 'collection' }
    if ($Value -is [System.Management.Automation.PSCustomObject] -or $Value.PSObject.Properties.Count -gt 0) { return 'object' }
    return $Value.GetType().Name
}

function Get-ScriptOutputStructure {
    <#
    .SYNOPSIS
        Describes an output object's shape for the Explore data structure helper.
    .DESCRIPTION
        Walks the object graph (bounded by -MaxDepth) and returns one record per
        field: Name, Path, Type, IsCollection, and nested Children.
    .PARAMETER OutputObject
        The object to describe. A collection is described by its first element.
    .PARAMETER MaxDepth
        Recursion bound for nested objects.
    .OUTPUTS
        [PSCustomObject[]] field descriptors.
    .EXAMPLE
        Get-ScriptOutputStructure -OutputObject $result
    #>
    [CmdletBinding()]
    [OutputType([PSCustomObject[]])]
    param(
        [Parameter()][object]$OutputObject,
        [Parameter()][int]$MaxDepth = $script:ScriptOutputMaxDepth
    )

    function Get-Fields {
        param([object]$Value, [string]$Prefix, [int]$Depth)
        if ($Depth -gt $MaxDepth -or $null -eq $Value) { return @() }

        $isCollection = $Value -is [System.Collections.IEnumerable] -and
            $Value -isnot [string] -and $Value -isnot [System.Collections.IDictionary]
        $target = $Value
        if ($isCollection) {
            $first = @($Value) | Select-Object -First 1
            if ($null -eq $first) { return @() }
            $target = $first
        }

        # Read children directly (not through a scriptblock round-trip, which
        # would enumerate a single-element array down to its element).
        $entries = New-Object System.Collections.Generic.List[object]
        if ($target -is [System.Collections.IDictionary]) {
            foreach ($key in @($target.Keys)) {
                $entries.Add([PSCustomObject]@{ Name = [string]$key; Value = $target[$key] }) | Out-Null
            }
        }
        else {
            foreach ($prop in @($target.PSObject.Properties | Where-Object { $_.MemberType -in @('NoteProperty', 'Property') })) {
                $entries.Add([PSCustomObject]@{ Name = $prop.Name; Value = $prop.Value }) | Out-Null
            }
        }

        $fields = New-Object System.Collections.Generic.List[object]
        foreach ($entry in $entries) {
            $name = [string]$entry.Name
            $child = $entry.Value
            $path = if ($Prefix) { "$Prefix.$name" } else { $name }
            $childType = Get-ScriptOutputTypeName -Value $child
            $children = @()
            if ($childType -eq 'object' -or $childType -eq 'collection') {
                $children = @(Get-Fields -Value $child -Prefix $path -Depth ($Depth + 1))
            }
            $fields.Add([PSCustomObject]@{
                Name         = $name
                Path         = $path
                Type         = $childType
                IsCollection = ($childType -eq 'collection')
                Children     = $children
            }) | Out-Null
        }
        return $fields.ToArray()
    }

    return @(Get-Fields -Value $OutputObject -Prefix '' -Depth 1)
}

function ConvertTo-ScriptOutputText {
    param([Parameter()][object]$Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string]) { return $Value }
    if ($Value -is [bool] -or $Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal]) {
        return [System.Convert]::ToString($Value, [System.Globalization.CultureInfo]::InvariantCulture)
    }
    try {
        return ($Value | ConvertTo-Json -Depth 6 -Compress)
    }
    catch {
        return [string]$Value
    }
}

function Resolve-ScriptOutputToken {
    param(
        [Parameter()][object]$Context,
        [Parameter(Mandatory)][string]$Path
    )
    $segments = $Path -split '\.'
    $current = $Context
    $missing = $false
    foreach ($segment in $segments) {
        if (-not (Test-ScriptOutputProperty -Object $current -Name $segment)) {
            $missing = $true
            break
        }
        $current = Get-ScriptOutputProperty -Object $current -Name $segment
    }
    if ($missing) {
        return [PSCustomObject]@{ Found = $false; Value = $null }
    }
    return [PSCustomObject]@{ Found = $true; Value = $current }
}

function Format-ScriptOutput {
    <#
    .SYNOPSIS
        Renders a script's output object through a markdown template.
    .DESCRIPTION
        Implements EPIC-007 SPEC.md §11.5: markdown-template rendering only. Tokens
        resolve against the output object (dotted paths supported); `{{#each Path}}`
        repeats its block per element, scoped to that element. An unresolved token
        renders the missing placeholder instead of throwing.
    .PARAMETER OutputObject
        The object returned by the sandboxed script.
    .PARAMETER MarkdownTemplate
        The version's markdown template.
    .PARAMETER MissingPlaceholder
        Format string for an unresolved token; `{0}` is the token path.
    .OUTPUTS
        [string] the rendered markdown.
    .EXAMPLE
        Format-ScriptOutput -OutputObject $result -MarkdownTemplate '# {{ Name }}'
    #>
    [CmdletBinding()]
    [OutputType([string])]
    param(
        [Parameter()][AllowNull()][object]$OutputObject,
        [Parameter()][AllowNull()][AllowEmptyString()][string]$MarkdownTemplate,
        [Parameter()][string]$MissingPlaceholder = $script:DefaultMissingPlaceholder
    )

    if ([string]::IsNullOrEmpty($MarkdownTemplate)) {
        return ''
    }

    $root = $OutputObject
    $isRootCollection = $root -is [System.Collections.IEnumerable] -and $root -isnot [string] -and $root -isnot [System.Collections.IDictionary]

    function Render-Template {
        param([string]$Template, [object]$Context, [bool]$ContextIsCollection)

        $missing = $MissingPlaceholder

        # `{{#each Path}}...{{/each}}` blocks (non-greedy, one pass per block).
        $eachPattern = [regex]'(?s)\{\{#each\s+([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}(.*?)\{\{/each\}\}'
        $rendered = $eachPattern.Replace($Template, {
                param($match)
                $path = $match.Groups[1].Value
                $inner = $match.Groups[2].Value
                $resolved = Resolve-ScriptOutputToken -Context $Context -Path $path
                if (-not $resolved.Found -or $null -eq $resolved.Value) {
                    return [string]::Format($missing, $path)
                }
                $elements = @($resolved.Value)
                $parts = New-Object System.Collections.Generic.List[string]
                foreach ($element in $elements) {
                    $parts.Add((Render-Template -Template $inner -Context $element -ContextIsCollection $false)) | Out-Null
                }
                return ($parts -join '')
            })

        # Scalar tokens.
        $tokenPattern = [regex]'\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}'
        $rendered = $tokenPattern.Replace($rendered, {
                param($match)
                $path = $match.Groups[1].Value
                if ($path -eq 'Count' -and $ContextIsCollection) {
                    return ConvertTo-ScriptOutputText -Value (@($Context).Count)
                }
                $resolved = Resolve-ScriptOutputToken -Context $Context -Path $path
                if (-not $resolved.Found) {
                    return [string]::Format($missing, $path)
                }
                $text = ConvertTo-ScriptOutputText -Value $resolved.Value
                if ($null -eq $text) { return [string]::Format($missing, $path) }
                return $text
            })

        return $rendered
    }

    return Render-Template -Template $MarkdownTemplate -Context $root -ContextIsCollection $isRootCollection
}
