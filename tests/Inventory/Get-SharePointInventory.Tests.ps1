BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-SharePointInventory' {
    BeforeAll {
        # Stub Graph cmdlets so Mock can find them
        function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

        # Mock Import-Module to prevent actual module loading
        Mock Import-Module { }

        # Mock Invoke-MgGraphRequest with switch for different endpoints
        Mock Invoke-MgGraphRequest {
            param($Method, $Uri, $OutputFilePath, $Headers)
            switch -Wildcard ($Uri) {
                '*/sites/getAllSites*' {
                    return @{
                        value = @(
                            @{
                                id                   = 'site-001'
                                displayName          = 'Marketing'
                                webUrl               = 'https://contoso.sharepoint.com/sites/Marketing'
                                createdDateTime      = '2023-06-01T00:00:00Z'
                                lastModifiedDateTime = '2025-02-10T14:00:00Z'
                                isPersonalSite       = $false
                            }
                            @{
                                id                   = 'site-002'
                                displayName          = 'Engineering'
                                webUrl               = 'https://contoso.sharepoint.com/sites/Engineering'
                                createdDateTime      = '2024-01-15T00:00:00Z'
                                lastModifiedDateTime = '2025-03-01T09:00:00Z'
                                isPersonalSite       = $false
                            }
                            @{
                                id                   = 'personal-001'
                                displayName          = 'Alice OneDrive'
                                webUrl               = 'https://contoso-my.sharepoint.com/personal/alice'
                                createdDateTime      = '2023-01-01T00:00:00Z'
                                lastModifiedDateTime = '2025-01-01T00:00:00Z'
                                isPersonalSite       = $true
                            }
                        )
                        '@odata.nextLink' = $null
                    }
                }
                '*/sites/site-001/drive*' {
                    return @{
                        quota = @{
                            used  = 524288000     # 500 MB
                            total = 27487790694400 # 25 TB
                        }
                        owner = @{
                            user = @{
                                displayName = 'Marketing Owner'
                                email       = 'mktg-owner@contoso.com'
                            }
                        }
                    }
                }
                '*/sites/site-002/drive*' {
                    return @{
                        quota = @{
                            used  = 1073741824    # 1 GB
                            total = 27487790694400
                        }
                        owner = @{
                            user = @{
                                displayName = 'Eng Lead'
                                email       = 'eng-lead@contoso.com'
                            }
                        }
                    }
                }
                default {
                    return @{ value = @() }
                }
            }
        }

        # Dot-source the collector and capture pipeline output
        . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
        $script:results = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-SharePointInventory.ps1"
    }

    It 'Returns results for non-personal sites only' {
        $script:results | Should -Not -BeNullOrEmpty
        # Personal site should be filtered out
        $script:results.Count | Should -Be 2
    }

    It 'Each result has all expected properties' {
        $expectedProps = @(
            'SiteUrl', 'SiteId', 'OwnerDisplayName', 'OwnerPrincipalName',
            'IsDeleted', 'StorageUsedMB', 'StorageAllocatedMB', 'FileCount',
            'ActiveFileCount', 'PageViewCount', 'LastActivityDate', 'SiteType'
        )
        foreach ($result in $script:results) {
            foreach ($prop in $expectedProps) {
                $result.PSObject.Properties.Name | Should -Contain $prop `
                    -Because "result for '$($result.SiteUrl)' should have property '$prop'"
            }
        }
    }

    It 'Correctly maps owner information from drive API' {
        $marketing = $script:results | Where-Object { $_.SiteUrl -like '*Marketing*' }
        $marketing | Should -Not -BeNullOrEmpty
        $marketing.OwnerDisplayName | Should -Be 'Marketing Owner'
        $marketing.OwnerPrincipalName | Should -Be 'mktg-owner@contoso.com'
    }

    It 'Calculates storage values in MB' {
        $marketing = $script:results | Where-Object { $_.SiteUrl -like '*Marketing*' }
        $marketing.StorageUsedMB | Should -BeGreaterThan 0
        $marketing.StorageAllocatedMB | Should -BeGreaterThan 0
    }

    Context 'When not connected to Microsoft Graph' {
        It 'Writes an error' {
            function Get-MgContext { return $null }

            $caughtError = $null
            try {
                . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
                . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-SharePointInventory.ps1"
            }
            catch {
                $caughtError = $_
            }
            $caughtError | Should -Not -BeNullOrEmpty
            $caughtError.ToString() | Should -Match 'Not connected to Microsoft Graph'
        }
    }

    Context 'When no sites are found' {
        It 'Returns nothing' {
            function Get-MgContext { return @{ TenantId = 'test-tenant-id' } }

            Mock Invoke-MgGraphRequest {
                return @{ value = @(); '@odata.nextLink' = $null }
            }

            . "$PSScriptRoot/../../src/M365-Assess/Orchestrator/AssessmentHelpers.ps1"
            $output = . "$PSScriptRoot/../../src/M365-Assess/Inventory/Get-SharePointInventory.ps1"
            $output | Should -BeNullOrEmpty
        }
    }
}
