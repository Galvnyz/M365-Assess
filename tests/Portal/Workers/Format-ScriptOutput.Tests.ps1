# Format-ScriptOutput.Tests.ps1
# Pester tests for T-0128 — custom-script output rendering via markdown template.
# Asserts: a populated template renders; a missing field renders an explicit
# placeholder (not an error); the structure helper lists the output fields;
# {{#each}} repeats over a collection.

#Requires -Module Pester
Set-StrictMode -Version Latest

Describe 'Format-ScriptOutput' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/Format-ScriptOutput.ps1')
    }

    It 'renders a populated markdown template' {
        $output = [PSCustomObject]@{ Name = 'Contoso'; Users = 42 }
        $template = "# {{ Name }}`n`nUsers: {{ Users }}"

        $rendered = Format-ScriptOutput -OutputObject $output -MarkdownTemplate $template

        $rendered | Should -Be "# Contoso`n`nUsers: 42"
    }

    It 'resolves a dotted path into a nested object' {
        $output = [PSCustomObject]@{
            Tenant = [PSCustomObject]@{ Name = 'Contoso'; Id = 't1' }
        }
        $rendered = Format-ScriptOutput -OutputObject $output -MarkdownTemplate '{{ Tenant.Name }} ({{ Tenant.Id }})'
        $rendered | Should -Be 'Contoso (t1)'
    }

    It 'renders an explicit placeholder for a missing field instead of throwing' {
        $output = [PSCustomObject]@{ Name = 'Contoso' }
        $template = 'Name: {{ Name }}; Owner: {{ Owner }}'

        $rendered = Format-ScriptOutput -OutputObject $output -MarkdownTemplate $template

        $rendered | Should -Be 'Name: Contoso; Owner: _(missing: Owner)_'
    }

    It 'renders a custom missing-field placeholder when supplied' {
        $rendered = Format-ScriptOutput -OutputObject ([PSCustomObject]@{}) `
            -MarkdownTemplate '{{ Nope }}' -MissingPlaceholder '<{0}?>'
        $rendered | Should -Be '<Nope?>'
    }

    It 'repeats an {{#each}} block over a collection' {
        $output = [PSCustomObject]@{
            Items = @(
                [PSCustomObject]@{ Name = 'one' },
                [PSCustomObject]@{ Name = 'two' }
            )
        }
        $template = "{{#each Items}}- {{ Name }}`n{{/each}}"

        $rendered = Format-ScriptOutput -OutputObject $output -MarkdownTemplate $template

        $rendered | Should -Be "- one`n- two`n"
    }

    It 'renders {{ Count }} for a collection-rooted output' {
        $output = @([PSCustomObject]@{ A = 1 }, [PSCustomObject]@{ A = 2 })
        $rendered = Format-ScriptOutput -OutputObject $output -MarkdownTemplate 'Total: {{ Count }}'
        $rendered | Should -Be 'Total: 2'
    }

    It 'returns an empty string for an empty template' {
        Format-ScriptOutput -OutputObject ([PSCustomObject]@{}) -MarkdownTemplate '' | Should -Be ''
    }
}

Describe 'Get-ScriptOutputStructure' {
    BeforeAll {
        . (Join-Path $PSScriptRoot '../../../portal/workers/M365Portal.Workers/Format-ScriptOutput.ps1')
    }

    It 'lists the output object fields with their types' {
        $output = [PSCustomObject]@{ Name = 'Contoso'; Count = 3; Enabled = $true }

        $structure = @(Get-ScriptOutputStructure -OutputObject $output)

        ($structure | ForEach-Object { $_.Name }) | Should -Contain 'Name'
        ($structure | ForEach-Object { $_.Name }) | Should -Contain 'Count'
        ($structure | Where-Object { $_.Name -eq 'Count' }).Type | Should -Be 'number'
        ($structure | Where-Object { $_.Name -eq 'Enabled' }).Type | Should -Be 'boolean'
    }

    It 'describes nested objects and collections with paths' {
        $output = [PSCustomObject]@{
            Tenant = [PSCustomObject]@{ Id = 't1' }
            Items  = @([PSCustomObject]@{ Name = 'x' })
        }

        $structure = @(Get-ScriptOutputStructure -OutputObject $output)

        $tenant = $structure | Where-Object { $_.Name -eq 'Tenant' }
        $tenant.Type | Should -Be 'object'
        ($tenant.Children | ForEach-Object { $_.Path }) | Should -Contain 'Tenant.Id'

        $items = $structure | Where-Object { $_.Name -eq 'Items' }
        $items.IsCollection | Should -BeTrue
        ($items.Children | Where-Object { $_.Name -eq 'Name' }).Path | Should -Be 'Items.Name'
    }

    It 'returns no fields for a null output' {
        @(Get-ScriptOutputStructure -OutputObject $null).Count | Should -Be 0
    }
}
