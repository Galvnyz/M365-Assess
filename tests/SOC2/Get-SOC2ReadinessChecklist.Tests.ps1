BeforeDiscovery {
    # Nothing needed at discovery time
}

Describe 'Get-SOC2ReadinessChecklist' {
    BeforeAll {
        $script:result = & "$PSScriptRoot/../../src/M365-Assess/SOC2/Get-SOC2ReadinessChecklist.ps1"
    }

    It 'returns a non-empty array' {
        @($script:result).Count | Should -BeGreaterThan 0
    }

    It 'all items have a Category property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'Category'
            $item.Category | Should -Not -BeNullOrEmpty
        }
    }

    It 'all items have a TSCReference property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'TSCReference'
            $item.TSCReference | Should -Not -BeNullOrEmpty
        }
    }

    It 'all items have a Requirement property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'Requirement'
            $item.Requirement | Should -Not -BeNullOrEmpty
        }
    }

    It 'all items have a Description property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'Description'
        }
    }

    It 'all items have an EvidenceType property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'EvidenceType'
        }
    }

    It 'all items have a Priority property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'Priority'
        }
    }

    It 'all items have an M365Relevance property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'M365Relevance'
        }
    }

    It 'all items have a Status property' {
        foreach ($item in @($script:result)) {
            $item.PSObject.Properties.Name | Should -Contain 'Status'
        }
    }

    It 'all Status values are Not Assessed' {
        foreach ($item in @($script:result)) {
            $item.Status | Should -Be 'Not Assessed' -Because "Item '$($item.Requirement)' should have Status 'Not Assessed'"
        }
    }

    It 'all Priority values are Required or Recommended' {
        $validPriorities = @('Required', 'Recommended')
        foreach ($item in @($script:result)) {
            $item.Priority | Should -BeIn $validPriorities -Because "Item '$($item.Requirement)' has priority '$($item.Priority)'"
        }
    }

    It 'all M365Relevance values start with None, Partial, or Direct' {
        foreach ($item in @($script:result)) {
            $item.M365Relevance | Should -Match '^(None|Partial|Direct)' `
                -Because "Item '$($item.Requirement)' has M365Relevance '$($item.M365Relevance)'"
        }
    }

    It 'TSCReferences follow pattern like CC1.1 or All' {
        foreach ($item in @($script:result)) {
            $item.TSCReference | Should -Match '^([A-Z]+\d+\.\d+|All)$' `
                -Because "TSCReference '$($item.TSCReference)' should match pattern CC1.1 or All"
        }
    }

    It 'returns at least 20 checklist items' {
        @($script:result).Count | Should -BeGreaterOrEqual 20
    }

    It 'items span multiple SOC2 categories' {
        $categories = @($script:result) | Select-Object -ExpandProperty Category -Unique
        $categories.Count | Should -BeGreaterOrEqual 3
    }
}
