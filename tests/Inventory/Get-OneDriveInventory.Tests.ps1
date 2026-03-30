BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-OneDriveInventory' {
    BeforeAll {
        # Stub Graph cmdlets so Mock can find them
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Mock Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Invoke-MgGraphRequest with switch for different endpoints
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $OutputFilePath, $Headers)
            switch -Wildcard ($Uri) {
                '*/users?*accountEnabled*' {
                    return @{
                        value = @(
                            @{
                                id                = 'user-001'
                                displayName       = 'Alice Smith'
                                userPrincipalName = 'alice@contoso.com'
                            }
                            @{
                                id                = 'user-002'
                                displayName       = 'Bob Jones'
                                userPrincipalName = 'bob@contoso.com'
                            }
                        )
                        '@odata.nextLink' = $null
                    }
                }
                '*/users/user-001/drive*' {
                    return @{
                        webUrl               = 'https://contoso-my.sharepoint.com/personal/alice_contoso_com'
                        lastModifiedDateTime = '2025-01-15T10:30:00Z'
                        quota = @{
                            used  = 1073741824   # 1 GB
                            total = 1099511627776 # 1 TB
                        }
                    }
                }
                '*/users/user-002/drive*' {
                    # Simulate user with no OneDrive provisioned
                    throw [System.Exception]::new("Request_ResourceNotFound")
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-OneDriveInventory.ps1"
    }

    It 'Returns results for users with OneDrive provisioned' {
        $script:results | Should -Not -BeNullOrEmpty
        # Only Alice has OneDrive; Bob gets a 404
        $script:results.Count | Should -Be 1
    }

    It 'Each result has all expected properties' {
        $expectedProps = @(
            'OwnerDisplayName', 'OwnerPrincipalName', 'SiteUrl', 'IsDeleted',
            'StorageUsedMB', 'StorageAllocatedMB', 'FileCount', 'ActiveFileCount',
            'LastActivityDate'
        )
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result should have property '$prop'"
            }
        }
    }

    It 'Correctly maps owner name and UPN' {
        $alice = $script:results | Where-Object { $_.OwnerPrincipalName -eq 'alice@contoso.com' }
        $alice | Should -Not -BeNullOrEmpty
        $alice.OwnerDisplayName | Should -Be 'Alice Smith'
    }

    It 'Calculates storage values in MB' {
        $alice = $script:results | Where-Object { $_.OwnerPrincipalName -eq 'alice@contoso.com' }
        $alice.StorageUsedMB | Should -BeGreaterThan 0
        $alice.StorageAllocatedMB | Should -BeGreaterThan 0
    }

    Context 'When not connected to Microsoft Graph' {
        It 'Writes an error' {
            function Get-MgContext { return $null }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-OneDriveInventory.ps1"
            }
            catch {
                $caughtError = $_
            }
            $caughtError | Should -Not -BeNullOrEmpty
            $caughtError.ToString() | Should -Match 'Not connected to Microsoft Graph'
        }
    }

    Context 'When no users are found' {
        It 'Returns nothing' {
            function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

            Mock Invoke-MgGraphRequest {
                return @{ value = @(); '@odata.nextLink' = $null }
            }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $output = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-OneDriveInventory.ps1"
            $output | Should -BeNullOrEmpty
        }
    }
}
