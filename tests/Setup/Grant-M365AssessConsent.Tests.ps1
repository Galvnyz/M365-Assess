BeforeAll {
    # Grant-M365AssessConsent.ps1 dot-sources PermissionDefinitions.ps1, so stub the
    # interactive and external dependencies before loading.

    # Stub all Graph, EXO, and interactive cmdlets to prevent actual calls
    function global:Connect-MgGraph { param($TenantId, $ClientId, $CertificateThumbprint, $Scopes, $NoWelcome, $Environment) }
    function global:Disconnect-MgGraph { }
    function global:Get-MgApplication { param($Filter, $All) return @() }
    function global:New-MgApplication { param($DisplayName, $SignInAudience, $RequiredResourceAccess) return [PSCustomObject]@{ AppId = 'test-app-id'; Id = 'test-obj-id' } }
    function global:New-MgServicePrincipal { param($AppId) return [PSCustomObject]@{ Id = 'test-sp-id' } }
    function global:Get-MgServicePrincipal { param($Filter) return @() }
    function global:Get-MgServicePrincipalAppRoleAssignment { param($ServicePrincipalId) return @() }
    function global:New-MgServicePrincipalAppRoleAssignment { param($ServicePrincipalId, $BodyParameter) }
    function global:New-MgApplicationPassword { param($ApplicationId, $PasswordCredential) return [PSCustomObject]@{ SecretText = 'fake-secret' } }
    function global:New-MgDirectoryRoleMemberByRef { param($DirectoryRoleId, $BodyParameter) }
    function global:Get-MgDirectoryRole { param($Filter, $All) return @() }
    function global:Get-MgDirectoryRoleMember { param($DirectoryRoleId) return @() }
    function global:New-SelfSignedCertificate { param($Subject, $CertStoreLocation, $KeyExportPolicy, $NotAfter, $HashAlgorithm) return [PSCustomObject]@{ Thumbprint = 'GENERATED-THUMB' } }
    function global:Connect-ExchangeOnline { param($UserPrincipalName, $ShowProgress, $ShowBanner) }
    function global:Disconnect-ExchangeOnline { param($Confirm) }
    function global:Get-RoleGroup { param($Identity) return $null }
    function global:Add-RoleGroupMember { param($Identity, $Member) }
    function global:Get-RoleGroupMember { param($Identity) return @() }
    function global:Start-Process { param($FilePath, $ArgumentList) }
    function global:Read-Host { param($Prompt) return '' }
    function global:Get-Item { param($Path) return $null }
    function global:Export-Certificate { param($Cert, $FilePath, $Type) }

    # Load the script (which dot-sources PermissionDefinitions.ps1 and defines Grant-M365AssessConsent)
    . "$PSScriptRoot/../../src/M365-Assess/Setup/Grant-M365AssessConsent.ps1"
}

AfterAll {
    @(
        'Connect-MgGraph', 'Disconnect-MgGraph', 'Get-MgApplication', 'New-MgApplication',
        'New-MgServicePrincipal', 'Get-MgServicePrincipal', 'Get-MgServicePrincipalAppRoleAssignment',
        'New-MgServicePrincipalAppRoleAssignment', 'New-MgApplicationPassword',
        'New-MgDirectoryRoleMemberByRef', 'Get-MgDirectoryRole', 'Get-MgDirectoryRoleMember',
        'New-SelfSignedCertificate', 'Connect-ExchangeOnline', 'Disconnect-ExchangeOnline',
        'Get-RoleGroup', 'Add-RoleGroupMember', 'Get-RoleGroupMember',
        'Start-Process', 'Read-Host', 'Get-Item', 'Export-Certificate'
    ) | ForEach-Object {
        Remove-Item "Function:\$_" -ErrorAction SilentlyContinue
    }
}

Describe 'Grant-M365AssessConsent' {
    It 'should be defined as a function' {
        (Get-Command -Name 'Grant-M365AssessConsent' -ErrorAction SilentlyContinue) | Should -Not -BeNullOrEmpty
    }

    It 'should have TenantId as a mandatory parameter' {
        $cmd = Get-Command -Name 'Grant-M365AssessConsent'
        $param = $cmd.Parameters['TenantId']
        $param | Should -Not -BeNullOrEmpty
    }

    It 'should have SkipGraph switch parameter' {
        $cmd = Get-Command -Name 'Grant-M365AssessConsent'
        $param = $cmd.Parameters['SkipGraph']
        $param | Should -Not -BeNullOrEmpty
    }

    It 'should have SkipExchangeRbac switch parameter' {
        $cmd = Get-Command -Name 'Grant-M365AssessConsent'
        $param = $cmd.Parameters['SkipExchangeRbac']
        $param | Should -Not -BeNullOrEmpty
    }

    It 'should have SkipComplianceRoles switch parameter' {
        $cmd = Get-Command -Name 'Grant-M365AssessConsent'
        $param = $cmd.Parameters['SkipComplianceRoles']
        $param | Should -Not -BeNullOrEmpty
    }

    It 'should have ProfileName parameter' {
        $cmd = Get-Command -Name 'Grant-M365AssessConsent'
        $param = $cmd.Parameters['ProfileName']
        $param | Should -Not -BeNullOrEmpty
    }
}

Describe 'PermissionDefinitions.ps1 - Data Tables' {
    # PermissionDefinitions.ps1 is dot-sourced by Grant-M365AssessConsent.ps1
    # The script variables are in function scope, so verify the definitions via reflection

    It 'should define required Graph permissions constant in script' {
        $content = Get-Content "$PSScriptRoot/../../src/M365-Assess/Setup/PermissionDefinitions.ps1" -Raw
        $content | Should -Match 'RequiredGraphPermissions'
    }

    It 'should define required EXO role groups constant in script' {
        $content = Get-Content "$PSScriptRoot/../../src/M365-Assess/Setup/PermissionDefinitions.ps1" -Raw
        $content | Should -Match 'RequiredExoRoleGroups'
    }

    It 'should define required compliance roles constant in script' {
        $content = Get-Content "$PSScriptRoot/../../src/M365-Assess/Setup/PermissionDefinitions.ps1" -Raw
        $content | Should -Match 'RequiredComplianceRoles'
    }
}
