BeforeAll {
    function Invoke-MgGraphRequest { param($Method, $Uri, $ErrorAction) }
    $collector = "$PSScriptRoot/../../src/M365-Assess/Entra/Get-EntraAdminRoleSeparationConfig.ps1"
}
Describe 'Authoritative admin-role separation evidence' {
    BeforeEach {
        $script:fixtureRoleRows = @(@{roleDefinitionId='62e90394-69f5-4237-9190-012177145e10';principal=@{id='user-001';'@odata.type'='#microsoft.graph.user'}})
        $script:plans = @()
        Mock Invoke-MgGraphRequest {
            if ($Uri -match 'roleAssignments') { return @{value=$script:fixtureRoleRows} }
            if ($Uri -match 'licenseDetails') { return @{value=@(@{servicePlans=$script:plans})} }
            if ($Uri -match 'transitiveMembers') { return @{value=@(@{id='user-001';'@odata.type'='#microsoft.graph.user'})} }
            throw "Unexpected request: $Uri"
        }
    }
    It 'passes only after verifying the user has no mailbox plans' {
        (. $collector).Status | Should -Be 'Pass'
        Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Uri -match 'roleAssignments' -and $Uri -notmatch 'filter=' }
    }
    It 'detects both Exchange mailbox plans' -ForEach @('efb87545-963c-4e0d-99df-69c6916d9eb0','19ec0d23-8335-4cbd-94ac-6050e30712fa') {
        $script:plans = @(@{servicePlanId=$_})
        (. $collector).Status | Should -Be 'Fail'
    }
    It 'does not query service principals as users' {
        $script:fixtureRoleRows += @{roleDefinitionId='62e90394-69f5-4237-9190-012177145e10';principal=@{id='app-001';'@odata.type'='#microsoft.graph.servicePrincipal'}}
        (. $collector).Status | Should -Be 'Pass'
        Should -Invoke Invoke-MgGraphRequest -Times 0 -ParameterFilter { $Uri -match '/users/app-001/' }
    }
    It 'includes group members and deduplicates users assigned through multiple paths' {
        $script:fixtureRoleRows += @{roleDefinitionId='62e90394-69f5-4237-9190-012177145e10';principal=@{id='group-001';'@odata.type'='#microsoft.graph.group'}}
        (. $collector).Status | Should -Be 'Pass'
        Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Uri -match 'transitiveMembers' }
        Should -Invoke Invoke-MgGraphRequest -Times 1 -Exactly -ParameterFilter { $Uri -match 'licenseDetails' }
    }
    It 'requires review when no privileged users are found' {
        $script:fixtureRoleRows=@()
        (. $collector).Status | Should -Be 'Review'
    }
    It 'does not turn unavailable principals into a pass' {
        $script:fixtureRoleRows[0].principal = $null
        (. $collector -WarningAction SilentlyContinue).Status | Should -Be 'Unknown'
    }
    It 'does not turn a failed role enumeration into a pass' -ForEach @('403 Forbidden','404 Not Found') {
        $script:failure=$_
        Mock Invoke-MgGraphRequest { throw $script:failure }
        (. $collector -WarningAction SilentlyContinue).Status | Should -Be 'Unknown'
    }
    It 'does not skip a confirmed user whose license request fails' {
        Mock Invoke-MgGraphRequest { throw '404 Not Found' } -ParameterFilter { $Uri -match 'licenseDetails' }
        (. $collector -WarningAction SilentlyContinue).Status | Should -Be 'Unknown'
    }
    It 'does not pass when group membership cannot be read' {
        $script:fixtureRoleRows[0].principal = @{id='group-001';'@odata.type'='#microsoft.graph.group'}
        Mock Invoke-MgGraphRequest { throw '403 Forbidden' } -ParameterFilter { $Uri -match 'transitiveMembers' }
        (. $collector -WarningAction SilentlyContinue).Status | Should -Be 'Unknown'
    }
}
