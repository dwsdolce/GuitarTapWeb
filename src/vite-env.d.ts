/// <reference types="vite/client" />

// Injected by vite.config.ts `define` at build time (and dev). __APP_VERSION__ is the
// marketing version from package.json; __APP_BUILD__ is the git commit count
// (`git rev-list --count HEAD`), matching how Swift (CFBundleVersion) and Python
// (version_build) derive their build numbers. Displayed as "1.0.1 (NNN)".
declare const __APP_VERSION__: string
declare const __APP_BUILD__: string