BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-SharePointOneDriveReport' {
    BeforeAll {
        function global:Assert-GraphConnection { return $true }
        function global:Write-AssessmentLog { param($Message, $Level) }

        Mock Invoke-MgGraphRequest {
            param($Method, $Uri)
            switch -Wildcard ($Uri) {
                '*/v1.0/admin/sharepoint/settings' {
                    return @{
                        sharingCapability                 = 'ExternalUserSharingOnly'
                        sharingDomainRestrictionMode      = 'allowList'
                        isResharingByExternalUsersEnabled = $false
                        isUnmanagedSyncClientRestricted   = $true
                        tenantDefaultTimezone             = 'Pacific Standard Time'
                        oneDriveLoopSharingCapability     = 'disabled'
                        isMacSyncAppEnabled               = $true
                        isLoopEnabled                     = $false
                    }
                }
                default { return @{ value = @() } }
            }
        }

        $script:result = & "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-SharePointOneDriveReport.ps1"
    }

    It 'returns a non-empty result' {
        $script:result | Should -Not -BeNullOrEmpty
    }

    It 'result has SharingCapability property' {
        $script:result.SharingCapability | Should -Not -BeNullOrEmpty
    }

    It 'returns expected sharing capability value' {
        $script:result.SharingCapability | Should -Be 'ExternalUserSharingOnly'
    }

    It 'result has IsResharingByExternalUsersEnabled property' {
        $script:result.PSObject.Properties.Name | Should -Contain 'IsResharingByExternalUsersEnabled'
    }

    It 'result has IsUnmanagedSyncClientRestricted property' {
        $script:result.PSObject.Properties.Name | Should -Contain 'IsUnmanagedSyncClientRestricted'
    }

    It 'IsResharingByExternalUsersEnabled is false' {
        $script:result.IsResharingByExternalUsersEnabled | Should -Be $false
    }

    It 'result has SharingDomainRestrictionMode property' {
        $script:result.PSObject.Properties.Name | Should -Contain 'SharingDomainRestrictionMode'
    }

    It 'result has all 8 expected properties' {
        $expectedProps = @(
            'SharingCapability', 'SharingDomainRestrictionMode',
            'IsResharingByExternalUsersEnabled', 'IsUnmanagedSyncClientRestricted',
            'TenantDefaultTimezone', 'OneDriveLoopSharingCapability',
            'IsMacSyncAppEnabled', 'IsLoopEnabled'
        )
        foreach ($prop in $expectedProps) {
            $script:result.PSObject.Properties.Name | Should -Contain $prop
        }
    }

    AfterAll {
        Remove-Item Function:\Assert-GraphConnection -ErrorAction SilentlyContinue
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}

Describe 'Get-SharePointOneDriveReport - 403 response' {
    BeforeAll {
        function global:Assert-GraphConnection { return $true }
        function global:Write-AssessmentLog { param($Message, $Level) }

        Mock Invoke-MgGraphRequest {
            throw [System.Exception]::new('403 Forbidden')
        }

        $script:result403 = & "$PSScriptRoot/../../src/M365-Assess/Collaboration/Get-SharePointOneDriveReport.ps1" -WarningAction SilentlyContinue
    }

    It 'returns nothing (early exit) on 403' {
        $script:result403 | Should -BeNullOrEmpty
    }

    AfterAll {
        Remove-Item Function:\Assert-GraphConnection -ErrorAction SilentlyContinue
        Remove-Item Function:\Write-AssessmentLog -ErrorAction SilentlyContinue
    }
}
