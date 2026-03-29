# M365-Assess module loader
# Dot-source the main orchestrator to import Invoke-M365Assessment function
. $PSScriptRoot\Invoke-M365Assessment.ps1

Export-ModuleMember -Function 'Invoke-M365Assessment'
