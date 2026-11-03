<#
.SYNOPSIS
    Genere un certificat TLS local (CA + serveur) pour VALARIA Gateway API.

.DESCRIPTION
    Cree dans data/tls/ :
      - ca.crt / ca.key       : autorite de certification locale
      - server.crt / server.key : certificat du serveur (localhost + IP locales)
    Installe la CA dans le magasin Windows (utilisateur + machine) pour que les
    clients HTTPS (Claude Desktop, navigateurs, Electron...) fassent confiance a
    https://localhost:8788.

    Necessite openssl (fourni par Git for Windows) et, pour l'import "machine",
    une console PowerShell administrateur.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File tools/generate-local-tls.ps1
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$tlsDir = Join-Path $root 'data/tls'

$openSsl = $null
$cmd = Get-Command openssl -ErrorAction SilentlyContinue
if ($cmd) { $openSsl = $cmd.Source }
if (-not $openSsl) {
    $candidates = @(
        'C:\Program Files\Git\usr\bin\openssl.exe',
        'C:\Program Files\Git\mingw64\bin\openssl.exe'
    )
    $openSsl = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $openSsl) {
    throw "openssl introuvable. Installez Git for Windows (fournit openssl) ou mkcert, puis relancez."
}

New-Item -ItemType Directory -Force $tlsDir | Out-Null

# Noms couverts par le certificat : localhost, nom de machine et toutes les IPv4 locales.
$san = [System.Collections.Generic.List[string]]::new()
$san.Add('DNS:localhost')
$san.Add("DNS:$env:COMPUTERNAME")
$san.Add('IP:127.0.0.1')
$san.Add('IP:::1')
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object { $san.Add("IP:$($_.IPAddress)") }
$sanLine = ($san | Select-Object -Unique) -join ','

$confPath = Join-Path $tlsDir 'openssl.cnf'
$conf = @"
[req]
default_bits = 2048
prompt = no
distinguished_name = dn
x509_extensions = v3_ca

[dn]
CN = VALARIA Gateway API Local CA

[v3_ca]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash

[server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = $sanLine
"@
Set-Content -LiteralPath $confPath -Value $conf -Encoding ASCII

$caKey = Join-Path $tlsDir 'ca.key'
$caCrt = Join-Path $tlsDir 'ca.crt'
$srvKey = Join-Path $tlsDir 'server.key'
$srvCsr = Join-Path $tlsDir 'server.csr'
$srvCrt = Join-Path $tlsDir 'server.crt'

Write-Host "Generation de la CA locale..."
& $openSsl req -x509 -newkey rsa:2048 -nodes -keyout $caKey -out $caCrt -days 3650 -config $confPath -extensions v3_ca 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Generation de la CA impossible.' }

Write-Host "Generation du certificat serveur..."
& $openSsl req -newkey rsa:2048 -nodes -keyout $srvKey -out $srvCsr -subj '/CN=localhost' 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Generation de la cle serveur impossible.' }
& $openSsl x509 -req -in $srvCsr -CA $caCrt -CAkey $caKey -CAcreateserial -out $srvCrt -days 825 -extfile $confPath -extensions server 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Signature du certificat serveur impossible.' }

Remove-Item $srvCsr, (Join-Path $tlsDir 'ca.srl') -ErrorAction SilentlyContinue

Write-Host "Installation de la CA dans le magasin Windows..."
$stores = @()
try {
    Import-Certificate -FilePath $caCrt -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
    $stores += 'utilisateur courant'
} catch {
    Write-Warning "Import CA (utilisateur courant) : $($_.Exception.Message)"
}
try {
    Import-Certificate -FilePath $caCrt -CertStoreLocation 'Cert:\LocalMachine\Root' | Out-Null
    $stores += 'ordinateur local'
} catch {
    Write-Warning "Import CA (machine) impossible (lancez en admin) : $($_.Exception.Message)"
}

Write-Host ''
Write-Host "Certificats crees dans : $tlsDir"
Write-Host "CA installee dans     : $($stores -join ', ')"
Write-Host "Noms couverts         : $sanLine"
Write-Host ''
Write-Host 'Ajoutez ces lignes dans .env puis redemarrez la passerelle :'
Write-Host '  HTTPS_PORT=8788'
Write-Host '  TLS_CERT_FILE=data/tls/server.crt'
Write-Host '  TLS_KEY_FILE=data/tls/server.key'
Write-Host ''
Write-Host 'URL pour Claude Desktop : https://localhost:8788/anthropic'

