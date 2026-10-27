param([Parameter(Mandatory = $true)][string]$User)
$meta = Join-Path $PSScriptRoot "kernel-metadata.json"
$raw = (Get-Content $meta -Raw) -replace "YOUR_KAGGLE_USER", $User
Set-Content $meta $raw
kaggle datasets create -p (Join-Path $PSScriptRoot "..\..\backend") --dir-mode zip 2>$null
kaggle kernels push -p $PSScriptRoot
Write-Host "Pushed kernel $User/aegis-rl-train. Add dataset $User/aegis-src if create failed (already exists is fine)."
