BeforeAll {
    function Invoke-SafeGraphRequest { param($Uri, $Method, $Body, $Headers) }
    . "$PSScriptRoot/../../src/M365-Assess/Common/Invoke-GraphReadBatch.ps1"
}
Describe 'Invoke-GraphReadBatch' {
    BeforeEach { Mock Start-Sleep {} }
    It 'chunks at 20, matches reversed responses by ID and uses GET only' {
        Mock Invoke-SafeGraphRequest {
            $requests = @((ConvertFrom-Json -InputObject $Body).requests)
            $requests.Count | Should -BeLessOrEqual 20
            @($requests | Where-Object method -ne 'GET').Count | Should -Be 0
            [array]::Reverse($requests)
            @{ responses = @($requests | ForEach-Object { @{id=$_.id;status=200;body=@{id=$_.id}} }) }
        }
        $requests = @(1..41 | ForEach-Object { @{id="$_";url="/users/$_"} })
        $result = Invoke-GraphReadBatch -Requests $requests
        $result.Count | Should -Be 41
        $result['21'].body.id | Should -Be '21'
        Should -Invoke Invoke-SafeGraphRequest -Times 3 -Exactly -ParameterFilter {
            $Uri -eq '/v1.0/$batch' -and $Method -eq 'POST'
        }
    }
    It 'retries only transient subrequests and honors Retry-After' {
        Mock Invoke-SafeGraphRequest {
            $requests = @((ConvertFrom-Json -InputObject $Body).requests)
            if ($requests.Count -eq 2) {
                return @{responses=@(@{id='a';status=200;body=@{id='a'}},@{id='b';status=429;headers=@{'Retry-After'='7'}})}
            }
            $requests[0].id | Should -Be 'b'
            @{responses=@(@{id='b';status=200;body=@{id='b'}})}
        }
        $result = Invoke-GraphReadBatch -Requests @(@{id='a';url='/users/a'},@{id='b';url='/users/b'})
        $result['a'].status | Should -Be 200
        $result['b'].status | Should -Be 200
        Should -Invoke Start-Sleep -Times 1 -Exactly -ParameterFilter { $Seconds -eq 7 }
    }
    It 'retains permanent failures and exhausted throttling as unsuccessful responses' {
        Mock Invoke-SafeGraphRequest { @{responses=@(@{id='a';status=403},@{id='b';status=429})} }
        $result = Invoke-GraphReadBatch -Requests @(@{id='a';url='/users/a'},@{id='b';url='/users/b'}) -MaxRetries 0
        $result['a'].status | Should -Be 403
        $result['b'].status | Should -Be 429
        Should -Invoke Start-Sleep -Times 0 -Exactly
    }
    It 'rejects malformed responses instead of returning partial evidence' -ForEach @(
        @{Responses=@()},
        @{Responses=@(@{id='a';status=200;body=@{}},@{id='a';status=200;body=@{}})},
        @{Responses=@(@{id='other';status=200;body=@{}})},
        @{Responses=@(@{id='a';status=200;body=@{'@odata.nextLink'='/more'}})},
        @{Responses=@(@{id='a';status=200;body=$null})}
    ) {
        Mock Invoke-SafeGraphRequest { @{responses=$Responses} }
        { Invoke-GraphReadBatch -Requests @(@{id='a';url='/users/a'}) } | Should -Throw '*GraphBatchIncomplete*'
    }
    It 'rejects writes and duplicate IDs before calling Graph' {
        Mock Invoke-SafeGraphRequest { throw 'must not execute' }
        { Invoke-GraphReadBatch -Requests @(@{id='a';url='/users/a';method='DELETE'}) } | Should -Throw '*GET*'
        { Invoke-GraphReadBatch -Requests @(@{id='a';url='/users/a'},@{id='A';url='/users/b'}) } | Should -Throw '*unique*'
        Should -Invoke Invoke-SafeGraphRequest -Times 0 -Exactly
    }
    It 'makes no calls for an empty request list' {
        Mock Invoke-SafeGraphRequest { throw 'must not execute' }
        (Invoke-GraphReadBatch -Requests @()).Count | Should -Be 0
        Should -Invoke Invoke-SafeGraphRequest -Times 0 -Exactly
    }
}
