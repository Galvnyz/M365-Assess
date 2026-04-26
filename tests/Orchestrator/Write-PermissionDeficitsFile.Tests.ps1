BeforeAll {
    # Stub Write-AssessmentLog so the helper can call it without the orchestrator scope.
    function Write-AssessmentLog { param($Level, $Message, $Section) }
    . (Join-Path $PSScriptRoot '../../src/M365-Assess/Orchestrator/Test-GraphPermissions.ps1')
}

Describe 'Write-PermissionDeficitsFile (#812 B2 followup)' {
    BeforeEach {
        $script:folder = Join-Path $TestDrive 'Assessment_test'
        New-Item -Path $script:folder -ItemType Directory -Force | Out-Null
    }

    It 'writes _PermissionDeficits.json with the documented schema' {
        $perSection = @{
            Identity = @('Policy.Read.All', 'Reports.Read.All')
            Email    = @()
        }
        Write-PermissionDeficitsFile -OutputFolder $script:folder -AuthMode 'AppOnly' `
            -ActiveSections @('Identity', 'Email') `
            -RequiredRoles @('Policy.Read.All', 'Reports.Read.All') `
            -GrantedRoles @('Policy.Read.All') `
            -MissingByRole @('Reports.Read.All') `
            -PerSection $perSection

        $jsonPath = Join-Path $script:folder '_PermissionDeficits.json'
        $jsonPath | Should -Exist
        $payload = Get-Content $jsonPath -Raw | ConvertFrom-Json
        $payload.schemaVersion | Should -Be '1.0'
        $payload.authMode      | Should -Be 'AppOnly'
        $payload.missing       | Should -Contain 'Reports.Read.All'
        $payload.sections.Identity.ok      | Should -BeFalse
        $payload.sections.Identity.missing | Should -Contain 'Reports.Read.All'
        $payload.sections.Email.ok         | Should -BeTrue
    }

    It 'records ok=true for every section when nothing is missing' {
        Write-PermissionDeficitsFile -OutputFolder $script:folder -AuthMode 'Delegated' `
            -ActiveSections @('Identity') `
            -RequiredRoles @('Policy.Read.All') `
            -GrantedRoles @('Policy.Read.All') `
            -MissingByRole @() `
            -PerSection @{ Identity = @('Policy.Read.All') }

        $payload = Get-Content (Join-Path $script:folder '_PermissionDeficits.json') -Raw | ConvertFrom-Json
        $payload.sections.Identity.ok | Should -BeTrue
    }

    It 'records the auth mode (Delegated vs AppOnly)' {
        Write-PermissionDeficitsFile -OutputFolder $script:folder -AuthMode 'Delegated' `
            -ActiveSections @('Identity') -RequiredRoles @() -GrantedRoles @() -MissingByRole @() `
            -PerSection @{ Identity = @() }
        $payload = Get-Content (Join-Path $script:folder '_PermissionDeficits.json') -Raw | ConvertFrom-Json
        $payload.authMode | Should -Be 'Delegated'
    }
}
