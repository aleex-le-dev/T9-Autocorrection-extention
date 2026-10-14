Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\Alex\.gemini\antigravity-ide\brain\bc8fed4f-b174-4d07-8e29-989ba8f30f97\google_account_page_1792019301420.png"
$src = [System.Drawing.Image]::FromFile($srcPath)

# Cadrage centré sur le visage d'Alexandre Janacek
$cropX = 1640
$cropY = 246
$cropSize = 170

$rect = New-Object System.Drawing.Rectangle($cropX, $cropY, $cropSize, $cropSize)
$bmp = New-Object System.Drawing.Bitmap(160, 160)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, 160, 160)), $rect, [System.Drawing.GraphicsUnit]::Pixel)

$destPath = "C:\Users\Alex\Desktop\tampermonkey-t9-autocorrect\user-profile.png"
$bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)

$g.Dispose()
$bmp.Dispose()
$src.Dispose()

Write-Output "Perfect avatar saved to $destPath"
