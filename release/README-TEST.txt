Verdium Release Test Bundle

Contents:
- customer-web: static customer app build
- driver-web: static driver app build
- admin-desktop: unpacked Windows desktop app (run @verdiumadmin.exe)
- server-cache: Node API source for local relay/testing

Quick test steps:
1) Start server-cache API
   - Open terminal in release/server-cache
   - Run: node server.js

2) Launch admin desktop
   - Open release/admin-desktop
   - Run: @verdiumadmin.exe

3) Open customer-web/index.html and driver-web/index.html in a static web server.
   - Example (from each folder): npx serve .

Note:
- API base URL must point to your deployed endpoint or reachable server-cache host.
