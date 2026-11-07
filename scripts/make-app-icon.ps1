# Derive a square icon from the user's original artwork, without stretching it.
# The left square contains the trunk/crown; a centered crop would mostly show sky.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$source = Join-Path $root 'web\images\nano-banana-4k-6aee231e41f09db7edd3a148.png'
$output = Join-Path $root 'artwork\app-icon.png'
New-Item -ItemType Directory -Force (Split-Path $output -Parent) | Out-Null
$image = [System.Drawing.Image]::FromFile($source)
$bitmap = New-Object System.Drawing.Bitmap(1024,1024)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $side = [Math]::Min($image.Width,$image.Height)
  $destination = New-Object System.Drawing.Rectangle(0,0,1024,1024)
  $crop = New-Object System.Drawing.Rectangle(0,0,$side,$side)
  $graphics.DrawImage($image,$destination,$crop,[System.Drawing.GraphicsUnit]::Pixel)
  $bitmap.Save($output,[System.Drawing.Imaging.ImageFormat]::Png)
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
  $image.Dispose()
}
Write-Output $output
