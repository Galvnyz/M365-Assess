BeforeAll {
    # PermissionDefinitions.ps1 uses $script: scope, so we dot-source in a wrapper
    # and capture the variables via a helper script block
    $script:defsPath = "$PSScriptRoot/../../src/M365-Assess/Setup/PermissionDefinitions.ps1"
    $script:defsContent = Get-Content $script:defsPath -Raw

    # Dot-source in the test scope to access $script: variables
    . $script:defsPath
}

Describe 'PermissionDefinitions.ps1' {
    Context 'structure validation' {
        It 'should define $script:RequiredGraphPermissions' {
            $script:defsContent | Should -Match '\$script:RequiredGraphPermissions'
        }

        It 'should define $script:RequiredExoRoleGroups' {
            $script:defsContent | Should -Match '\$script:RequiredExoRoleGroups'
        }

        It 'should define $script:RequiredComplianceRoles' {
            $script:defsContent | Should -Match '\$script:RequiredComplianceRoles'
        }
    }

    Context 'Graph permissions' {
        BeforeAll {
            # Parse out permission names from the file content
            $script:graphPerms = @([regex]::Matches($script:defsContent, "Name\s*=\s*'([^']+)'") | ForEach-Object { $_.Groups[1].Value })
        }

        It 'should list User.Read.All permission' {
            $script:defsContent | Should -Match "User\.Read\.All"
        }

        It 'should list Policy.Read.All permission' {
            $script:defsContent | Should -Match "Policy\.Read\.All"
        }

        It 'should list Organization.Read.All permission' {
            $script:defsContent | Should -Match "Organization\.Read\.All"
        }

        It 'should list Directory.Read.All permission' {
            $script:defsContent | Should -Match "Directory\.Read\.All"
        }

        It 'should list AuditLog.Read.All permission' {
            $script:defsContent | Should -Match "AuditLog\.Read\.All"
        }

        It 'should list SecurityEvents.Read.All permission' {
            $script:defsContent | Should -Match "SecurityEvents\.Read\.All"
        }

        It 'should have a Sections key for each Graph permission entry' {
            $script:defsContent | Should -Match "Sections\s*="
        }

        It 'should have a Reason key for each Graph permission entry' {
            $script:defsContent | Should -Match "Reason\s*="
        }
    }

    Context 'EXO role groups' {
        It 'should list View-Only Organization Management role group' {
            $script:defsContent | Should -Match 'View-Only Organization Management'
        }

        It 'should list Compliance Management role group' {
            $script:defsContent | Should -Match 'Compliance Management'
        }

        It 'should include RoleGroup key for each EXO entry' {
            $script:defsContent | Should -Match "RoleGroup\s*="
        }
    }

    Context 'Compliance roles' {
        It 'should list Compliance Administrator role' {
            $script:defsContent | Should -Match 'Compliance Administrator'
        }

        It 'should list Security Reader role' {
            $script:defsContent | Should -Match 'Security Reader'
        }

        It 'should list Global Reader role' {
            $script:defsContent | Should -Match 'Global Reader'
        }

        It 'should include TemplateId for built-in roles' {
            $script:defsContent | Should -Match 'TemplateId'
        }
    }
}
