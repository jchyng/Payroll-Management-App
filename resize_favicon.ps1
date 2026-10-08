Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('C:\Users\jcy03\dev\Payroll-Management-App\icon-512.png')
$thumb32 = $img.GetThumbnailImage(32, 32, $null, [IntPtr]::Zero)
$thumb32.Save('C:\Users\jcy03\dev\Payroll-Management-App\favicon-32.png', [System.Drawing.Imaging.ImageFormat]::Png)
$thumb16 = $img.GetThumbnailImage(16, 16, $null, [IntPtr]::Zero)
$thumb16.Save('C:\Users\jcy03\dev\Payroll-Management-App\favicon-16.png', [System.Drawing.Imaging.ImageFormat]::Png)
$img.Dispose()
$thumb32.Dispose()
$thumb16.Dispose()
Write-Host 'Done'