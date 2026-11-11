# Проверки без настоящих семейных данных

## Автоматические тесты

```bash
npm ci
npm test
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

JavaScript-тесты проверяют геометрию, даты, кадрирование и экспорт. Rust-тесты
используют временные SQLite-базы и покрывают транзакции, перенос, цитаты,
кадрирование и конфликты ревизий. Никаких данных пользователя для них не нужно.

## Настоящий WebView на Windows

Сначала соберите debug-приложение:

```powershell
cargo build --manifest-path src-tauri/Cargo.toml
New-Item -ItemType Directory -Force test-results | Out-Null
$env:ATLAS_DATA_DIR = Join-Path $env:TEMP ('atlas-smoke-' + [guid]::NewGuid().ToString())
$env:ATLAS_SMOKE_RESULT = Join-Path (Get-Location) 'test-results/native-smoke.json'
try {
  $process = Start-Process -FilePath '.\src-tauri\target\debug\family-atlas-desktop.exe' -PassThru -Wait
  Get-Content $env:ATLAS_SMOKE_RESULT
  if ($process.ExitCode -ne 0) { throw 'Native smoke check failed' }
  $env:ATLAS_SMOKE_RESULT = Join-Path (Get-Location) 'test-results/native-restart-smoke.json'
  $restart = Start-Process -FilePath '.\src-tauri\target\debug\family-atlas-desktop.exe' -PassThru -Wait
  Get-Content $env:ATLAS_SMOKE_RESULT
  if ($restart.ExitCode -ne 0) { throw 'Native restart check failed' }
} finally {
  Remove-Item Env:ATLAS_DATA_DIR -ErrorAction SilentlyContinue
  Remove-Item Env:ATLAS_SMOKE_RESULT -ErrorAction SilentlyContinue
}
```

Первый запуск проверяет автоматическое обучение, переходы, пропуск, повтор по «?»,
фокус клавиатуры и сохранность несохранённой карточки. Второй процесс использует
тот же временный профиль и проверяет, что обучение больше не открывается само,
но по-прежнему доступно по кнопке «?».

Тест создаёт вымышленных людей и цветную картинку. В настоящем WebView проверяются
редактирование, рамки и пиксели разных портретов, отмена, сохранность оригинала,
встроенный фон, SVG и PNG. Окно закрывается после записи результата.

**Обе переменные задавайте вместе и используйте новый пустой временный каталог.**
Не указывайте настоящий каталог приложения. Эти возможности существуют только
в debug-сборке; release их не использует. В headless Linux/macOS эту проверку
нельзя считать выполненной только по успешному `cargo test`.
