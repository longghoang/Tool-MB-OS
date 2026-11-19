$toolDir = "C:\Users\Admin\Desktop\Extension\Tool-BBXN_MBOS"
$logDir = Join-Path $toolDir "logs"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Test-ListeningPort($port) {
    return [bool](Get-NetTCPConnection `
        -LocalPort $port `
        -State Listen `
        -ErrorAction SilentlyContinue)
}

# Chạy Node.js app trên cổng 3000
if (-not (Test-ListeningPort 3000)) {
    $node = (Get-Command node -ErrorAction Stop).Source

    Start-Process -FilePath $node `
        -ArgumentList "app.js" `
        -WorkingDirectory $toolDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "app.log") `
        -RedirectStandardError (Join-Path $logDir "app-error.log")
} else {
    Write-Host "Cổng 3000 đã có tiến trình lắng nghe, bỏ qua app.js."
}

# Chạy HTTPS proxy: https://localhost:443 -> http://localhost:3000
if (-not (Test-ListeningPort 443)) {
    Start-Process -FilePath $env:ComSpec `
        -ArgumentList "/c local-ssl-proxy --source 443 --target 3000" `
        -WorkingDirectory $toolDir `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "proxy.log") `
        -RedirectStandardError (Join-Path $logDir "proxy-error.log")
} else {
    Write-Host "Cổng 443 đã có tiến trình lắng nghe, bỏ qua local-ssl-proxy."
}

# Chạy đúng lệnh 9router trong cửa sổ PowerShell riêng
if (-not (Test-ListeningPort 20128)) {
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList "-NoExit", "-Command", "9router"
} else {
    Write-Host "9router có vẻ đang chạy trên cổng 20128, bỏ qua."
}

# Chờ proxy khởi động rồi mở Tool
for ($i = 0; $i -lt 15; $i++) {
    if (Test-ListeningPort 443) {
        Start-Process "https://localhost/home"
        break
    }

    Start-Sleep -Seconds 1
}

Write-Host "Đã gửi lệnh khởi động Tool-BBXN_MBOS."
Write-Host "Log nằm trong thư mục: $logDir"